import type { SportyBetProvider, SportyBetEvent } from './contracts.js';
import type { CandidateSelection, NormalizedMarket, RiskLevel, SlipDraft, Sport } from '../types/domain.js';
import { isAllowedBasketballOverMarket } from './basketball-over-markets.js';
export { isAllowedBasketballOverMarket } from './basketball-over-markets.js';

export interface LiveSlipSnapshot {
  slip: SlipDraft;
  combinedOdds: number;
}

/** A business-level absence, not an AI outage or unexpected server failure. */
export class NoTodayMarketsError extends Error {
  readonly statusCode = 404;
  constructor(sport: Sport) {
    super(`No supported ${sport} matches with active SportyBet markets remain today in Nigeria (WAT). No later-day games were included. Try another sport or check again tomorrow.`);
    this.name = 'NoTodayMarketsError';
  }
}

const rounded = (value: number, digits = 2) => Number(value.toFixed(digits));

const riskLevel = (odds: number): RiskLevel => {
  if (odds <= 1.4) return 'lower';
  if (odds <= 2.1) return 'medium';
  return 'higher';
};

/** Exclude Under picks in generated basketball slips, without excluding Over/Under markets as a whole. */
export function isBasketballUnderPick(
  market: Pick<NormalizedMarket, 'sport' | 'selectionName'>,
): boolean {
  if (market.sport !== 'basketball') return false;
  const selection = market.selectionName.trim();
  return /\bunder\b/i.test(selection) || /(?:^|[\s(:])u\s*\d+(?:\.\d+)?\b/i.test(selection);
}

export function marketFamily(market: Pick<NormalizedMarket, 'marketName' | 'category'>): string {
  const name = market.marketName.toLowerCase();
  const category = market.category.toLowerCase();
  if (/quarter|\bhalf\b|\bperiod\b/.test(name)) return 'period';
  if (/team|competitor|home|away|individual/.test(name) && /total|over\/under|o\/u/.test(name))
    return 'team-total';
  if (/handicap|spread/.test(name)) return 'handicap';
  if (/winner|moneyline|match result|1x2/.test(name)) return 'winner';
  if (/over\/under|\btotal\b|o\/u/.test(name)) return 'game-total';
  if (/both teams|btts/.test(name)) return 'btts';
  if (/corner/.test(name)) return 'corners';
  if (/card|booking/.test(name)) return 'cards';
  return `other:${category || name}`;
}

function selectionDirection(market: Pick<NormalizedMarket, 'selectionName'>): string {
  const label = market.selectionName.toLowerCase();
  if (/^over\b/.test(label)) return 'over';
  if (/^under\b/.test(label)) return 'under';
  return label.replace(/\d+(?:\.\d+)?/g, '#').trim();
}

export function chooseVariedMarket(
  markets: NormalizedMarket[],
  targetPerLeg: number,
  usedFamilies: ReadonlyMap<string, number>,
  usedDirections: ReadonlyMap<string, number>,
): NormalizedMarket | null {
  const eligible = markets.filter(
    (market) =>
      (market.sport !== 'basketball' || isAllowedBasketballOverMarket(market)) &&
      market.status === 'active' &&
      Number.isFinite(market.odds) &&
      market.odds > 1.01 &&
      market.odds <= 1000,
  );
  if (!eligible.length) return null;
  const scored = eligible.map((market) => {
    const family = marketFamily(market);
    const direction = selectionDirection(market);
    const priceDifference = Math.abs(Math.log(market.odds / targetPerLeg));
    const familyPenalty = Math.min(0.6, (usedFamilies.get(family) ?? 0) * 0.27);
    const directionPenalty = Math.min(0.24, (usedDirections.get(direction) ?? 0) * 0.08);
    const exoticPenalty = family.startsWith('other:') ? 0.3 : 0;
    return { market, score: priceDifference + familyPenalty + directionPenalty + exoticPenalty };
  });
  scored.sort((left, right) => left.score - right.score || left.market.providerMarketId.localeCompare(right.market.providerMarketId));
  return scored[0]?.market ?? null;
}

export function lagosCalendarDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Rotate real competitions so the first N fixtures do not all come from the supplier's first league. */
export function interleaveLeagues(events: SportyBetEvent[]): SportyBetEvent[] {
  const grouped = new Map<string, SportyBetEvent[]>();
  for (const event of events) {
    const league = event.league?.trim().toLowerCase() || 'unknown';
    const group = grouped.get(league) ?? [];
    group.push(event);
    grouped.set(league, group);
  }
  const ordered = [...grouped.values()].sort((a, b) =>
    (a[0]?.startsAt.getTime() ?? 0) - (b[0]?.startsAt.getTime() ?? 0),
  );
  const result: SportyBetEvent[] = [];
  let remaining = events.length;
  while (remaining > 0) {
    for (const group of ordered) {
      const next = group.shift();
      if (next) {
        result.push(next);
        remaining -= 1;
      }
    }
  }
  return result;
}

/** All general discovery is restricted to today's Africa/Lagos calendar date. */
export async function buildLiveSlipSnapshot(
  provider: SportyBetProvider,
  sport: Sport,
  gameCount: number,
  targetOdds?: number,
  _todayOnly = true,
): Promise<LiveSlipSnapshot> {
  void _todayOnly;
  if (!Number.isSafeInteger(gameCount) || gameCount < 1) {
    throw new Error('The number of games must be a positive whole number.');
  }
  const count = gameCount;
  const now = new Date();
  const today = lagosCalendarDay(now);
  const seenEventIds = new Set<string>();
  const events = (await provider.listEvents(sport))
    .filter((event) => {
      if (event.status !== 'scheduled' || event.startsAt.getTime() <= now.getTime()) return false;
      if (lagosCalendarDay(event.startsAt) !== today) return false;
      if (seenEventIds.has(event.providerEventId)) return false;
      seenEventIds.add(event.providerEventId);
      return true;
    })
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  const diverseEvents = interleaveLeagues(events);
  const availableLegs = Math.max(1, Math.min(count, events.length));
  const desiredPerLeg = Math.max(1.05, Math.pow(targetOdds ?? 3, 1 / availableLegs));
  const candidates: CandidateSelection[] = [];
  const usedFamilies = new Map<string, number>();
  const usedDirections = new Map<string, number>();

  for (let offset = 0; offset < diverseEvents.length && candidates.length < count;) {
    const batch = diverseEvents.slice(offset, offset + Math.min(4, count - candidates.length));
    offset += batch.length;
    const results = await Promise.allSettled(batch.map((event) => provider.getMarkets(event.providerEventId)));
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      const event = batch[index];
      if (!event) continue;
      const markets = result.value.filter((market) => market.sport === sport);
      const market = chooseVariedMarket(markets, desiredPerLeg, usedFamilies, usedDirections);
      if (!market) continue;
      const family = marketFamily(market);
      const direction = selectionDirection(market);
      usedFamilies.set(family, (usedFamilies.get(family) ?? 0) + 1);
      usedDirections.set(direction, (usedDirections.get(direction) ?? 0) + 1);
      const impliedProbability = rounded(Math.min(95, 100 / market.odds));
      candidates.push({
        ...market,
        fixture: {
          id: event.providerEventId,
          providerId: event.providerEventId,
          sport,
          league: event.league ?? 'Unknown competition',
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          startsAt: event.startsAt,
          status: event.status,
        },
        modelProbability: impliedProbability,
        confidenceScore: impliedProbability,
        dataQuality: 'medium',
        riskLevel: riskLevel(market.odds),
        reasoning: [
          'Live SportyBet market snapshot.',
          'Chosen using target-price proximity and market-family diversity; not a prediction of a win.',
        ],
      });
      if (candidates.length === count) break;
    }
  }
  const selections = candidates.slice(0, count);
  if (!selections.length) throw new NoTodayMarketsError(sport);
  const combinedOdds = rounded(selections.reduce((total, selection) => total * selection.odds, 1));
  return {
    combinedOdds,
    slip: {
      id: crypto.randomUUID(),
      selections,
      ...(targetOdds ? { targetOdds } : {}),
      riskMode: 'balanced',
    },
  };
}
