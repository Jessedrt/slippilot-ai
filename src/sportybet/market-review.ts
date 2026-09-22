import type { SlipAnalyzer, SlipAnalysis } from '../ai/slip-analyzer.js';
import { passesAiQuality } from '../ai/quality-gate.js';
import { minimumQualityForTarget } from '../ai/quality-policy.js';
import type { CandidateSelection, NormalizedMarket, RiskMode, Sport } from '../types/domain.js';
import type { ProviderSelection, SportyBetProvider } from './contracts.js';
import { isAllowedBasketballOverMarket } from './basketball-over-markets.js';
import { buildLiveSlipSnapshot, marketFamily, type LiveSlipSnapshot } from './discovery.js';
import { selectTwoOddsPicks } from './two-odds-preset.js';
import {
  BasketballEvidenceError,
  evaluateBasketballTotal,
  isBasketballGameTotal,
  type BasketballStatisticsProvider,
} from '../sports/basketball-statistics.js';

/** Review confidence measures evidence quality, NOT the probability of winning. */
export class MarketReviewUnavailableError extends Error {
  readonly statusCode = 424;
  constructor() {
    super(
      'Market alternatives could not be reviewed or verified with SportyBet. No unverified selection or booking code was substituted. Retry later.',
    );
    this.name = 'MarketReviewUnavailableError';
  }
}
export interface ReviewedSnapshot extends LiveSlipSnapshot {
  analysis: SlipAnalysis;
  rejectedOptions: number;
  reviewedOptions: number;
}
const identity = (market: NormalizedMarket): string =>
  [
    market.eventId,
    market.providerMarketId,
    market.providerSelectionId,
    market.specifier ?? '',
  ].join('|');
const bookingIdentity = (selection: ProviderSelection): string =>
  [selection.eventId, selection.marketId, selection.selectionId, selection.specifier ?? ''].join(
    '|',
  );
const toBookingSelection = (candidate: CandidateSelection): ProviderSelection => ({
  eventId: candidate.eventId,
  marketId: candidate.providerMarketId,
  selectionId: candidate.providerSelectionId,
  odds: candidate.odds,
  ...(candidate.specifier != null ? { specifier: candidate.specifier } : {}),
});
export const validMarket = (market: NormalizedMarket, sport: Sport, eventId: string): boolean =>
  market.eventId === eventId &&
  market.sport === sport &&
  market.status === 'active' &&
  (sport !== 'basketball' || isAllowedBasketballOverMarket(market)) &&
  Number.isFinite(market.odds) &&
  market.odds > 1.01 &&
  market.odds <= 1000;

/** Compare several market families on each real event instead of blindly using the first pick. */
export function shortlistMarketOptions(
  markets: NormalizedMarket[],
  sport: Sport,
  eventId: string,
  targetPerLeg: number,
  maxOptions = 5,
): NormalizedMarket[] {
  const active = markets.filter((market) => validMarket(market, sport, eventId));
  const unique = [...new Map(active.map((market) => [identity(market), market])).values()];
  void targetPerLeg; // Compatibility parameter; target price never determines eligibility.
  unique.sort((a, b) => identity(a).localeCompare(identity(b)));
  const result: NormalizedMarket[] = [];
  const seenFamilies = new Set<string>();
  for (const market of unique) {
    const family = marketFamily(market);
    if (seenFamilies.has(family)) continue;
    seenFamilies.add(family);
    result.push(market);
    if (result.length >= maxOptions) return result;
  }
  const seen = new Set(result.map(identity));
  for (const market of unique) {
    if (seen.has(identity(market))) continue;
    result.push(market);
    if (result.length >= maxOptions) break;
  }
  return result;
}
function reviewScore(
  review: SlipAnalysis['selections'][number],
  odds: number,
  target: number,
  riskMode: RiskMode,
): number {
  const risk = { lower: 0, medium: 4, higher: 9 }[review.risk];
  const riskWeight = riskMode === 'conservative' ? 1.5 : riskMode === 'aggressive' ? 0.5 : 1;
  const pricePenalty = Math.min(12, Math.abs(Math.log(odds / target)) * 5);
  return (
    (review.verdict === 'keep' ? 15 : 0) + review.confidence - risk * riskWeight - pricePenalty
  );
}
/** Refresh the exact outcome. A missing outcome is skippable; outages are not. */
async function preflightOption(
  provider: SportyBetProvider,
  candidate: CandidateSelection,
): Promise<CandidateSelection | null> {
  if (!provider.refreshSelections) return candidate;
  const requested = toBookingSelection(candidate);
  let refreshed: ProviderSelection[];
  try {
    refreshed = await provider.refreshSelections([requested]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SportyBet selection unavailable:'))
      return null;
    throw new MarketReviewUnavailableError();
  }
  const exact = refreshed.filter(
    (selection) =>
      bookingIdentity(selection) === bookingIdentity(requested) &&
      Number.isFinite(selection.odds) &&
      selection.odds > 1.01 &&
      selection.odds <= 1000,
  );
  if (exact.length !== 1) return null;
  const updatedOdds = exact[0]!.odds;
  if (Math.abs(updatedOdds / candidate.odds - 1) >= 0.05) return null;
  return { ...candidate, odds: updatedOdds };
}

export async function buildReviewedLiveSlipSnapshot(
  provider: SportyBetProvider,
  analyzer: SlipAnalyzer,
  sport: Sport,
  gameCount: number,
  targetOdds?: number,
  riskMode: RiskMode = 'balanced',
  basketballStatistics?: BasketballStatisticsProvider,
): Promise<ReviewedSnapshot> {
  if (!Number.isSafeInteger(gameCount) || gameCount < 1) throw new Error('Invalid game count.');
  const minimum = minimumQualityForTarget(targetOdds, riskMode);
  const cautiousTwoOdds = riskMode === 'conservative' && targetOdds === 2;
  const marketCache = new Map<string, Promise<NormalizedMarket[]>>();
  const getCachedMarkets = (id: string): Promise<NormalizedMarket[]> => {
    let promise = marketCache.get(id);
    if (!promise) {
      promise = provider.getMarkets(id);
      marketCache.set(id, promise);
    }
    return promise;
  };
  const cachedProvider: SportyBetProvider = {
    name: provider.name,
    listEvents: (requestedSport) => provider.listEvents(requestedSport),
    findEvents: (home, away) => provider.findEvents(home, away),
    getEvent: (id) => provider.getEvent(id),
    getMarkets: getCachedMarkets,
    resolveBookingCode: (code) => provider.resolveBookingCode(code),
    createBookingCode: (selections) => provider.createBookingCode(selections),
    health: () => provider.health(),
  };
  const inspectCount = Math.min(60, Math.max(gameCount + 8, gameCount * 2));
  const snapshot = await buildLiveSlipSnapshot(cachedProvider, sport, inspectCount);
  const targetPerLeg = Math.max(1.05, Math.pow(targetOdds ?? 3, 1 / Math.max(1, gameCount)));
  const options: CandidateSelection[] = [];
  const statisticsCache = new Map<string, Promise<unknown>>();
  const optionsPerFixture = Math.max(
    1,
    Math.min(5, Math.floor(60 / snapshot.slip.selections.length)),
  );
  for (const original of snapshot.slip.selections) {
    let markets: NormalizedMarket[];
    try {
      markets = await getCachedMarkets(original.eventId);
    } catch {
      throw new MarketReviewUnavailableError();
    }
    const reviewableMarkets =
      sport === 'basketball'
        ? markets.filter((market) =>
            isBasketballGameTotal({
              ...original,
              ...market,
            }),
          )
        : markets;
    const choices = shortlistMarketOptions(
      reviewableMarkets,
      sport,
      original.eventId,
      targetPerLeg,
      optionsPerFixture,
    );
    for (const choice of choices) {
      let candidate: CandidateSelection = {
        ...original,
        ...choice,
        modelProbability: 0,
        confidenceScore: 0,
        reasoning: [
          'Provider-listed active alternative awaiting evidence review and exact booking verification.',
        ],
      };
      if (sport === 'basketball') {
        if (!basketballStatistics)
          throw new BasketballEvidenceError(
            'Basketball totals are unavailable because no authorized statistics provider is configured. Odds are not used as evidence and no statistics are invented.',
            'provider_not_configured',
          );
        let snapshotPromise = statisticsCache.get(candidate.eventId);
        if (!snapshotPromise) {
          snapshotPromise = basketballStatistics.getSnapshot({
            bookmakerEventId: candidate.eventId,
            competition: candidate.fixture.league,
            homeTeam: candidate.fixture.homeTeam,
            awayTeam: candidate.fixture.awayTeam,
            startsAt: candidate.fixture.startsAt,
          });
          statisticsCache.set(candidate.eventId, snapshotPromise);
        }
        let rawSnapshot: unknown;
        try {
          rawSnapshot = await snapshotPromise;
        } catch {
          throw new BasketballEvidenceError(
            'Basketball statistics provider unavailable. No market was recommended and no target was forced.',
            'provider_unavailable',
          );
        }
        try {
          const assessment = evaluateBasketballTotal(candidate, rawSnapshot);
          if (
            assessment.statisticalSupport !== 'supported' ||
            assessment.recommendationVerdict !== 'keep'
          )
            continue;
          candidate = {
            ...candidate,
            assessment,
            confidenceScore: assessment.evidenceQualityScore,
            dataQuality: assessment.evidenceQualityScore >= 80 ? 'high' : 'medium',
            reasoning: [
              `Statistical projection ${assessment.statisticalProjection}; bookmaker implied probability ${assessment.bookmakerImpliedProbability}%.`,
              `Verified source: ${assessment.sources[0]!.name}, retrieved ${assessment.sources[0]!.retrievedAt.toISOString()}.`,
            ],
          };
        } catch (error) {
          if (error instanceof BasketballEvidenceError || error instanceof Error) continue;
          continue;
        }
      }
      options.push(candidate);
    }
  }
  if (!options.length) {
    if (sport === 'basketball')
      throw new BasketballEvidenceError(
        'Insufficient statistical evidence: no basketball total had fresh, consistent, metric-specific support.',
      );
    throw new MarketReviewUnavailableError();
  }
  let analysis: SlipAnalysis;
  try {
    analysis = await analyzer.analyze(options);
  } catch {
    throw new MarketReviewUnavailableError();
  }
  const reviews = new Map(analysis.selections.map((review) => [review.index, review]));
  if (
    reviews.size !== options.length ||
    options.some((_option, index) => !reviews.has(index + 1))
  ) {
    throw new MarketReviewUnavailableError();
  }
  type RankedChoice = {
    candidate: CandidateSelection;
    review: SlipAnalysis['selections'][number];
    score: number;
  };
  const ranked = new Map<string, RankedChoice[]>();
  for (const [index, candidate] of options.entries()) {
    const review = reviews.get(index + 1)!;
    if (!passesAiQuality(review, minimum)) continue;
    if (cautiousTwoOdds && (review.verdict !== 'keep' || review.risk !== 'lower')) continue;
    const score = reviewScore(review, candidate.odds, targetPerLeg, riskMode);
    const alternatives = ranked.get(candidate.eventId) ?? [];
    alternatives.push({ candidate, review, score });
    ranked.set(candidate.eventId, alternatives);
  }
  const verifiedChoices: RankedChoice[] = [];
  for (const fixture of snapshot.slip.selections) {
    if (!cautiousTwoOdds && verifiedChoices.length >= gameCount) break;
    const alternatives = (ranked.get(fixture.eventId) ?? []).sort((a, b) => b.score - a.score);
    for (const alternative of alternatives) {
      const verified = await preflightOption(provider, alternative.candidate);
      if (!verified) continue;
      verifiedChoices.push({ ...alternative, candidate: verified });
      break;
    }
  }
  const picks = cautiousTwoOdds
    ? selectTwoOddsPicks(verifiedChoices, gameCount, targetPerLeg)
    : verifiedChoices;
  if (!picks.length) {
    const error = new Error(
      cautiousTwoOdds
        ? `No fully reviewed lower-risk, bookable selections met the 2.00 preset and ${minimum}/100 AI quality minimum. Try again later or choose a different risk mode; no code was prepared.`
        : ranked.size
          ? 'None of the AI-reviewed markets could be verified for booking. Try rebuilding when SportyBet updates its outcomes; no code was created.'
          : `No AI-reviewed market reached the ${minimum}/100 quality minimum without rejection. Fewer picks are returned rather than lowering the pass mark; no booking code was prepared.`,
    );
    Object.assign(error, { statusCode: 409 });
    throw error;
  }
  const selections = picks.map(({ candidate, review }) => ({
    ...candidate,
    confidenceScore: review.evidenceQualityScore ?? review.confidence,
    modelProbability: 0,
    riskLevel: review.risk,
    assessment: candidate.assessment ?? {
      evidenceQualityScore: review.evidenceQualityScore ?? review.confidence,
      statisticalSupport: review.statisticalSupport ?? 'supported',
      recommendationVerdict: review.verdict,
      assessedAt: new Date(analysis.analyzedAt),
      expiresAt: new Date(new Date(analysis.analyzedAt).getTime() + 30 * 60_000),
      sources: (review.sourceUrls ?? []).map((url) => ({
        name: new URL(url).hostname,
        url,
        retrievedAt: new Date(review.evidenceRetrievedAt ?? analysis.analyzedAt),
        kind: 'research' as const,
      })),
      conflictingEvidence: review.conflictingEvidence ?? false,
      bookmakerImpliedProbability: Number((100 / candidate.odds).toFixed(2)),
    },
    reasoning: [
      review.reason,
      provider.refreshSelections
        ? 'Exact outcome verified by SportyBet before selection; rechecked when booking. No win is guaranteed.'
        : 'Selected after comparing active alternatives; booking verification occurs later. No win is guaranteed.',
    ],
  }));
  const conservativeSummary = cautiousTwoOdds
    ? `2.00 conservative preset: selected only AI-reviewed keep/lower-risk outcomes, prioritized stronger evidence and lower odds across kickoff windows. ${picks.length < gameCount ? `Only ${picks.length} of ${gameCount} requested fixtures qualified; the target was not forced. ` : ''}Scores are not win probabilities. `
    : '';
  return {
    ...snapshot,
    slip: { ...snapshot.slip, selections, riskMode },
    combinedOdds: Number(
      selections.reduce((odds, selection) => odds * selection.odds, 1).toFixed(2),
    ),
    analysis: {
      ...analysis,
      selections: picks.map(({ review }, index) => ({ ...review, index: index + 1 })),
      summary:
        `${conservativeSummary}AI pass mark ${minimum}/100 (quality, not win probability). Compared ${options.length} active alternatives across ${snapshot.slip.selections.length} fixtures. ${provider.refreshSelections ? `Verified ${picks.length} exact booking outcomes. ` : ''}${analysis.summary}`.slice(
          0,
          600,
        ),
    },
    rejectedOptions: analysis.selections.filter((item) => !passesAiQuality(item, minimum)).length,
    reviewedOptions: options.length,
  };
}
