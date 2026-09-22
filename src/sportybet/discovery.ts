import type { SportyBetProvider, SportyBetEvent } from './contracts.js';
import type {
  CandidateSelection,
  NormalizedMarket,
  RiskLevel,
  SlipDraft,
  Sport,
} from '../types/domain.js';
import { isAllowedBasketballOverMarket } from './basketball-over-markets.js';
import { leagueExclusionReason } from './league-quality.js';
export { isAllowedBasketballOverMarket } from './basketball-over-markets.js';

export interface LiveSlipSnapshot {
  slip: SlipDraft;
  combinedOdds: number;
  scheduleDate: string;
  dayOffset: 0 | 1 | 2;
}

/** Backwards-compatible error class. No unavailable fixtures or markets are invented. */
export class NoTodayMarketsError extends Error {
  readonly statusCode = 404;
  constructor(sport: Sport, excludedLeagues = 0) {
    super(
      `No supported ${sport} matches with eligible active SportyBet markets were found today, tomorrow or the following day in Nigeria (WAT). No later dates were included. Try another sport or check later.${excludedLeagues ? ` The league filter excluded ${excludedLeagues} fixture${excludedLeagues === 1 ? '' : 's'} from youth, reserve, amateur, lower-tier, friendly or simulated competitions; see Explore for the unfiltered fixture list.` : ''}`,
    );
    this.name = 'NoTodayMarketsError';
  }
}

export class MarketVerificationUnavailableError extends Error {
  readonly statusCode = 424;
  constructor() {
    super(
      'The sports provider could not verify all markets for the selected day. No later day was substituted or fixtures invented. Please retry.',
    );
    this.name = 'MarketVerificationUnavailableError';
  }
}

const rounded = (value: number, digits = 2) => Number(value.toFixed(digits));

const riskLevel = (odds: number): RiskLevel => {
  if (odds <= 1.4) return 'lower';
  if (odds <= 2.1) return 'medium';
  return 'higher';
};

/** Legacy compatibility: all active basketball markets and both directions are allowed. */
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
  _targetPerLeg: number,
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
    const familyPenalty = Math.min(0.6, (usedFamilies.get(family) ?? 0) * 0.27);
    const directionPenalty = Math.min(0.24, (usedDirections.get(direction) ?? 0) * 0.08);
    const exoticPenalty = family.startsWith('other:') ? 0.3 : 0;
    // Eligibility and stable market diversity are evaluated before any target-odds
    // preference. Target price is deliberately not evidence of market quality.
    return { market, score: familyPenalty + directionPenalty + exoticPenalty };
  });
  scored.sort(
    (left, right) =>
      left.score - right.score ||
      left.market.providerMarketId.localeCompare(right.market.providerMarketId),
  );
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
  const ordered = [...grouped.values()].sort(
    (a, b) => (a[0]?.startsAt.getTime() ?? 0) - (b[0]?.startsAt.getTime() ?? 0),
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

/**
 * Spread the day's opportunities across four-hour Lagos kickoff windows before
 * querying markets. A morning-heavy provider listing must not exhaust the
 * requested count before we reach valid evening fixtures. Within each window,
 * retain league diversity. Empty/unavailable windows never force a fake pick.
 */
export function interleaveKickoffWindows(events: SportyBetEvent[]): SportyBetEvent[] {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const windows = new Map<number, SportyBetEvent[]>();
  for (const event of events) {
    const hour = Number(clock.format(event.startsAt));
    const window = Math.floor(hour / 4);
    const group = windows.get(window) ?? [];
    group.push(event);
    windows.set(window, group);
  }
  const ordered = [...windows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group]) => interleaveLeagues(group));
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

/** Build from one verified calendar day at a time. Never mix future dates into a partly filled current day. */
export async function buildLiveSlipSnapshot(
  provider: SportyBetProvider,
  sport: Sport,
  gameCount: number,
  targetOdds?: number,
  _todayOnly = true,
): Promise<LiveSlipSnapshot> {
  void _todayOnly; // Retained for older callers; the explicit three-day fallback applies to all requests.
  if (!Number.isSafeInteger(gameCount) || gameCount < 1) {
    throw new Error('The number of games must be a positive whole number.');
  }
  const now = new Date();
  const seen = new Set<string>();
  const events = (await provider.listEvents(sport))
    .filter((event) => {
      if (
        event.status !== 'scheduled' ||
        !Number.isFinite(event.startsAt.getTime()) ||
        event.startsAt.getTime() <= now.getTime() ||
        seen.has(event.providerEventId)
      )
        return false;
      seen.add(event.providerEventId);
      return true;
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  let excludedLeagues = 0;
  for (const offset of [0, 1, 2] as const) {
    const date = lagosCalendarDay(new Date(now.getTime() + offset * 86_400_000));
    const dayEvents = events.filter((event) => lagosCalendarDay(event.startsAt) === date);
    if (!dayEvents.length) continue;
    // Filter competitions BEFORE filling the requested count; don't let ten
    // early reserve/amateur fixtures crowd out later established matches.
    const eligibleDayEvents = dayEvents.filter((event) => {
      if (!leagueExclusionReason(sport, event.league)) return true;
      excludedLeagues += 1;
      return false;
    });
    if (!eligibleDayEvents.length) continue;
    const diverseEvents = interleaveKickoffWindows(eligibleDayEvents);
    const desiredPerLeg = Math.max(
      1.05,
      Math.pow(targetOdds ?? 3, 1 / Math.max(1, Math.min(gameCount, eligibleDayEvents.length))),
    );
    const candidates: CandidateSelection[] = [];
    const usedFamilies = new Map<string, number>();
    const usedDirections = new Map<string, number>();
    let marketVerificationFailed = false;
    for (let index = 0; index < diverseEvents.length && candidates.length < gameCount;) {
      const batch = diverseEvents.slice(index, index + Math.min(4, gameCount - candidates.length));
      index += batch.length;
      const results = await Promise.allSettled(
        batch.map((event) => provider.getMarkets(event.providerEventId)),
      );
      for (const [position, result] of results.entries()) {
        if (result.status !== 'fulfilled') {
          marketVerificationFailed = true;
          continue;
        }
        const event = batch[position];
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
          modelProbability: 0,
          confidenceScore: 0,
          dataQuality: 'medium',
          riskLevel: riskLevel(market.odds),
          reasoning: [
            'Live SportyBet market snapshot.',
            `Bookmaker implied probability is ${impliedProbability}% before margin; it is not a model projection or recommendation.`,
            'Awaiting independent evidence review; target odds did not affect eligibility.',
          ],
        });
        if (candidates.length === gameCount) break;
      }
    }
    if (!candidates.length) {
      // Only a verifiably empty day may trigger tomorrow's search.
      if (marketVerificationFailed) throw new MarketVerificationUnavailableError();
      continue;
    }
    const selections = candidates.slice(0, gameCount);
    return {
      scheduleDate: date,
      dayOffset: offset,
      combinedOdds: rounded(selections.reduce((total, selection) => total * selection.odds, 1)),
      slip: {
        id: crypto.randomUUID(),
        selections,
        ...(targetOdds ? { targetOdds } : {}),
        riskMode: 'balanced',
      },
    };
  }
  throw new NoTodayMarketsError(sport, excludedLeagues);
}
