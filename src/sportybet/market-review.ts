import type { SlipAnalyzer, SlipAnalysis } from '../ai/slip-analyzer.js';
import type { CandidateSelection, NormalizedMarket, RiskMode, Sport } from '../types/domain.js';
import type { ProviderSelection, SportyBetProvider } from './contracts.js';
import { isAllowedBasketballOverMarket } from './basketball-over-markets.js';
import { buildLiveSlipSnapshot, marketFamily, type LiveSlipSnapshot } from './discovery.js';

/** A review can compare market evidence; its scores are NOT calibrated win probabilities. */
export class MarketReviewUnavailableError extends Error {
  readonly statusCode = 424;
  constructor() {
    super('Market alternatives could not be reviewed or verified with SportyBet. No unverified selection or booking code was substituted. Retry later.');
    this.name = 'MarketReviewUnavailableError';
  }
}

export interface ReviewedSnapshot extends LiveSlipSnapshot {
  analysis: SlipAnalysis;
  rejectedOptions: number;
  reviewedOptions: number;
}

const identity = (market: NormalizedMarket): string =>
  [market.eventId, market.providerMarketId, market.providerSelectionId, market.specifier ?? ''].join('|');

const bookingIdentity = (selection: ProviderSelection): string =>
  [selection.eventId, selection.marketId, selection.selectionId, selection.specifier ?? ''].join('|');

const toBookingSelection = (candidate: CandidateSelection): ProviderSelection => ({
  eventId: candidate.eventId, marketId: candidate.providerMarketId,
  selectionId: candidate.providerSelectionId, odds: candidate.odds,
  ...(candidate.specifier != null ? { specifier: candidate.specifier } : {}),
});

export const validMarket = (market: NormalizedMarket, sport: Sport, eventId: string): boolean =>
  market.eventId === eventId && market.sport === sport && market.status === 'active' &&
  (sport !== 'basketball' || isAllowedBasketballOverMarket(market)) &&
  Number.isFinite(market.odds) && market.odds > 1.01 && market.odds <= 1000;

/**
 * Compare active supplier outcomes, excluding basketball handicap/spread by
 * user preference. All other categories and both Over/Under directions remain.
 */
export function shortlistMarketOptions(
  markets: NormalizedMarket[], sport: Sport, eventId: string, targetPerLeg: number,
  maxOptions = 5,
): NormalizedMarket[] {
  const active = markets.filter((market) => validMarket(market, sport, eventId));
  const unique = [...new Map(active.map((market) => [identity(market), market])).values()];
  const byPrice = (a: NormalizedMarket, b: NormalizedMarket) =>
    Math.abs(Math.log(a.odds / targetPerLeg)) - Math.abs(Math.log(b.odds / targetPerLeg)) ||
    identity(a).localeCompare(identity(b));
  unique.sort(byPrice);
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

function reviewScore(review: SlipAnalysis['selections'][number], odds: number,
  target: number, riskMode: RiskMode): number {
  const risk = { lower: 0, medium: 4, higher: 9 }[review.risk];
  const riskWeight = riskMode === 'conservative' ? 1.5 : riskMode === 'aggressive' ? 0.5 : 1;
  const pricePenalty = Math.min(12, Math.abs(Math.log(odds / target)) * 5);
  return (review.verdict === 'keep' ? 15 : 0) + review.confidence -
    risk * riskWeight - pricePenalty;
}

/**
 * Refresh exactly the selected outcome, rather than treating its presence in an
 * event's generic market feed as proof that SportyBet can create a share code.
 * A missing outcome can be skipped, but a provider outage cannot be passed off
 * as a suspended selection. Material odds changes require a fresh AI review.
 */
async function preflightOption(provider: SportyBetProvider,
  candidate: CandidateSelection): Promise<CandidateSelection | null> {
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
  const exact = refreshed.filter((selection) =>
    bookingIdentity(selection) === bookingIdentity(requested) &&
    Number.isFinite(selection.odds) && selection.odds > 1.01 && selection.odds <= 1000);
  if (exact.length !== 1) return null;
  const updatedOdds = exact[0]!.odds;
  if (Math.abs(updatedOdds / candidate.odds - 1) >= 0.05) return null;
  return { ...candidate, odds: updatedOdds };
}

/** Review distinct active market choices for each real fixture before choosing one per match. */
export async function buildReviewedLiveSlipSnapshot(
  provider: SportyBetProvider, analyzer: SlipAnalyzer, sport: Sport,
  gameCount: number, targetOdds?: number, riskMode: RiskMode = 'balanced',
): Promise<ReviewedSnapshot> {
  if (!Number.isSafeInteger(gameCount) || gameCount < 1) throw new Error('Invalid game count.');
  // Cache a single provider snapshot per event within the request: no doubled calls or
  // inconsistent odds between fixture discovery and the alternatives being reviewed.
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
  // Inspect more than the requested game count. A fixture whose displayed market
  // is active may have no bookable outcome, and AI may reject other fixtures.
  const inspectCount = Math.min(60, Math.max(gameCount + 8, gameCount * 2));
  const snapshot = await buildLiveSlipSnapshot(cachedProvider, sport, inspectCount, targetOdds);
  const targetPerLeg = Math.max(1.05, Math.pow(targetOdds ?? 3, 1 / Math.max(1, gameCount)));
  const options: CandidateSelection[] = [];
  const optionsPerFixture = Math.max(1, Math.min(5, Math.floor(60 / snapshot.slip.selections.length)));
  for (const original of snapshot.slip.selections) {
    let markets: NormalizedMarket[];
    try {
      markets = await getCachedMarkets(original.eventId);
    } catch {
      throw new MarketReviewUnavailableError();
    }
    const choices = shortlistMarketOptions(markets, sport, original.eventId,
      targetPerLeg, optionsPerFixture);
    for (const choice of choices) {
      options.push({ ...original, ...choice,
        modelProbability: 0, confidenceScore: 0,
        reasoning: ['Provider-listed active alternative awaiting AI review and exact booking verification.'],
      });
    }
  }
  if (!options.length) throw new MarketReviewUnavailableError();
  let analysis: SlipAnalysis;
  try {
    analysis = await analyzer.analyze(options);
  } catch {
    throw new MarketReviewUnavailableError();
  }
  const reviews = new Map(analysis.selections.map((review) => [review.index, review]));
  if (reviews.size !== options.length || options.some((_option, index) => !reviews.has(index + 1))) {
    throw new MarketReviewUnavailableError();
  }
  type RankedChoice = { candidate: CandidateSelection;
    review: SlipAnalysis['selections'][number]; score: number };
  const ranked = new Map<string, RankedChoice[]>();
  for (const [index, candidate] of options.entries()) {
    const review = reviews.get(index + 1)!;
    if (review.verdict === 'reject' || !Number.isFinite(review.confidence)) continue;
    const score = reviewScore(review, candidate.odds, targetPerLeg, riskMode);
    const alternatives = ranked.get(candidate.eventId) ?? [];
    alternatives.push({ candidate, review, score });
    ranked.set(candidate.eventId, alternatives);
  }
  const picks: RankedChoice[] = [];
  // Preserve the fixture order produced by kickoff-window balancing. An outcome
  // that cannot be booked is replaced only by another outcome already reviewed
  // for the SAME match; never silently replace a user-selected slip at code time.
  for (const fixture of snapshot.slip.selections) {
    if (picks.length >= gameCount) break;
    const alternatives = (ranked.get(fixture.eventId) ?? [])
      .sort((a, b) => b.score - a.score);
    for (const alternative of alternatives) {
      const verified = await preflightOption(provider, alternative.candidate);
      if (!verified) continue;
      picks.push({ ...alternative, candidate: verified });
      break;
    }
  }
  if (!picks.length) {
    const error = new Error(ranked.size
      ? 'None of the AI-reviewed markets could be verified for booking. Try rebuilding when SportyBet updates its outcomes; no code was created.'
      : 'AI rejected all reviewed active markets. No booking code was prepared.');
    Object.assign(error, { statusCode: 409 });
    throw error;
  }
  const selections = picks.map(({ candidate, review }) => ({ ...candidate,
    confidenceScore: review.confidence,
    modelProbability: 0, // Evidence quality is not a calibrated winning probability.
    riskLevel: review.risk,
    reasoning: [review.reason, provider.refreshSelections
      ? 'Exact outcome verified by SportyBet before selection; rechecked when booking. No win is guaranteed.'
      : 'Selected after comparing active alternatives; booking verification occurs later. No win is guaranteed.'],
  }));
  return {
    ...snapshot,
    slip: { ...snapshot.slip, selections, riskMode },
    combinedOdds: Number(selections.reduce((odds, selection) => odds * selection.odds, 1).toFixed(2)),
    analysis: { ...analysis,
      selections: picks.map(({ review }, index) => ({ ...review, index: index + 1 })),
      summary: `Compared ${options.length} active alternatives across ${snapshot.slip.selections.length} fixtures. ${provider.refreshSelections ? `Verified ${picks.length} exact booking outcomes. ` : ''}${analysis.summary}`.slice(0, 600),
    },
    rejectedOptions: analysis.selections.filter((item) => item.verdict === 'reject').length,
    reviewedOptions: options.length,
  };
}
