import type { SlipAnalyzer, SlipAnalysis } from '../ai/slip-analyzer.js';
import type { CandidateSelection, NormalizedMarket, RiskMode, Sport } from '../types/domain.js';
import type { ProviderSelection, SportyBetProvider } from './contracts.js';
import { buildLiveSlipSnapshot, marketFamily, type LiveSlipSnapshot } from './discovery.js';

/** A review can compare market evidence; its scores are NOT calibrated win probabilities. */
export class MarketReviewUnavailableError extends Error {
  readonly statusCode = 424;
  constructor() {
    super('Market alternatives could not be reviewed. No unreviewed selection or booking code was substituted. Retry later.');
    this.name = 'MarketReviewUnavailableError';
  }
}

export class MarketBookingUnavailableError extends Error {
  readonly statusCode = 424;
  constructor() {
    super('No AI-reviewed market could be confirmed as bookable by SportyBet. Try building again later. No unverified selection or booking code was substituted.');
    this.name = 'MarketBookingUnavailableError';
  }
}

export interface ReviewedSnapshot extends LiveSlipSnapshot {
  analysis: SlipAnalysis;
  rejectedOptions: number;
  reviewedOptions: number;
}

const identity = (market: NormalizedMarket): string =>
  [market.eventId, market.providerMarketId, market.providerSelectionId, market.specifier ?? ''].join('|');

export const validMarket = (market: NormalizedMarket, sport: Sport, eventId: string): boolean =>
  market.eventId === eventId && market.sport === sport && market.status === 'active' &&
  Number.isFinite(market.odds) && market.odds > 1.01 && market.odds <= 1000;

/**
 * Consider every active supplier outcome, then select a bounded, diverse
 * shortlist for AI comparison. No market category or direction is banned.
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

type ReviewedOption = {
  candidate: CandidateSelection;
  review: SlipAnalysis['selections'][number];
  score: number;
};

/** Ask the exact-outcome endpoint before showing a pick as bookable. */
async function confirmBookable(
  provider: SportyBetProvider, option: ReviewedOption,
): Promise<ReviewedOption | null> {
  if (option.candidate.fixture.startsAt.getTime() <= Date.now()) return null;
  // Test adapters without a booking-verification capability retain their existing
  // behavior. The real SportyBet adapter implements refreshSelections.
  if (!provider.refreshSelections) return option;
  const candidate = option.candidate;
  const requested: ProviderSelection = {
    eventId: candidate.eventId, marketId: candidate.providerMarketId,
    selectionId: candidate.providerSelectionId, odds: candidate.odds,
    ...(candidate.specifier != null ? { specifier: candidate.specifier } : {}),
  };
  let refreshed: ProviderSelection[];
  try {
    refreshed = await provider.refreshSelections([requested]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SportyBet selection unavailable:')) return null;
    // A provider outage is NOT evidence that an outcome has been suspended.
    throw new MarketReviewUnavailableError();
  }
  const matches = refreshed.filter((item) => item.eventId === requested.eventId &&
    item.marketId === requested.marketId && item.selectionId === requested.selectionId &&
    (item.specifier ?? null) === (requested.specifier ?? null) &&
    Number.isFinite(item.odds) && item.odds > 1.01 && item.odds <= 1000);
  if (matches.length !== 1) return null;
  return { ...option, candidate: { ...candidate, odds: matches[0]!.odds,
    lastUpdated: new Date() } };
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
  const inspectCount = Math.min(60, gameCount + 3);
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
        reasoning: ['Provider-listed active alternative awaiting AI review and booking verification.'],
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
  // Rank ALL reviewed choices per fixture. The highest-scoring market may still
  // be absent from SportyBet's booking endpoint despite appearing on its event
  // page. Try the next *already analyzed* market rather than removing the game,
  // selecting by fuzzy name, or waiting until code generation to discover it.
  const ranked = new Map<string, ReviewedOption[]>();
  for (const [index, candidate] of options.entries()) {
    const review = reviews.get(index + 1)!;
    if (review.verdict === 'reject' || !Number.isFinite(review.confidence)) continue;
    const option = { candidate, review, score: reviewScore(review, candidate.odds, targetPerLeg, riskMode) };
    const group = ranked.get(candidate.eventId) ?? [];
    group.push(option);
    ranked.set(candidate.eventId, group);
  }
  if (!ranked.size) {
    const error = new Error('AI rejected all reviewed active markets. No booking code was prepared.');
    Object.assign(error, { statusCode: 409 });
    throw error;
  }
  const picks: ReviewedOption[] = [];
  let unverifiedFixtures = 0;
  for (const choices of ranked.values()) {
    choices.sort((left, right) => right.score - left.score);
    let verified: ReviewedOption | null = null;
    for (const choice of choices) {
      verified = await confirmBookable(provider, choice);
      if (verified) break;
    }
    if (!verified) { unverifiedFixtures += 1; continue; }
    picks.push(verified);
    if (picks.length >= gameCount) break;
  }
  if (!picks.length) throw new MarketBookingUnavailableError();
  const selections = picks.map(({ candidate, review }) => ({ ...candidate,
    confidenceScore: review.confidence,
    modelProbability: 0, // Evidence quality is not a calibrated winning probability.
    riskLevel: review.risk,
    reasoning: [review.reason, 'Exact outcome checked with SportyBet before inclusion; booking availability can still change.'],
  }));
  return {
    ...snapshot,
    slip: { ...snapshot.slip, selections, riskMode },
    combinedOdds: Number(selections.reduce((odds, selection) => odds * selection.odds, 1).toFixed(2)),
    analysis: { ...analysis,
      selections: picks.map(({ review }, index) => ({ ...review, index: index + 1 })),
      summary: `Compared ${options.length} active alternatives across ${snapshot.slip.selections.length} fixtures. ${provider.refreshSelections ? `${selections.length} exact outcomes confirmed for booking; ${unverifiedFixtures} fixtures had no confirmable reviewed market. ` : 'Exact booking verification was unavailable at build time. '}${analysis.summary}`.slice(0, 600),
    },
    rejectedOptions: analysis.selections.filter((item) => item.verdict === 'reject').length,
    reviewedOptions: options.length,
  };
}
