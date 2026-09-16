import type { SportyBetProvider } from './contracts.js';
import type { CandidateSelection, RiskLevel, SlipDraft, Sport } from '../types/domain.js';

export interface LiveSlipSnapshot {
  slip: SlipDraft;
  combinedOdds: number;
}

const rounded = (value: number, digits = 2) => Number(value.toFixed(digits));

const riskLevel = (odds: number): RiskLevel => {
  if (odds <= 1.4) return 'lower';
  if (odds <= 2.1) return 'medium';
  return 'higher';
};

export function isAllowedBasketballOverMarket(
  market: Pick<CandidateSelection, 'marketName' | 'selectionName'>,
): boolean {
  const name = market.marketName.trim().toLowerCase();
  const selection = market.selectionName.trim().toLowerCase();
  if (!/^over(?:\s|$)/.test(selection)) return false;
  const fullTime = /^over\/under(?:\s*\(incl\. overtime\))?$/.test(name);
  const firstHalf = /^1st half\s*-\s*(?:total|over\/under)$/.test(name);
  const individual =
    /^(?:home|away|competitor\s*[12])(?:\s+team)?\s+(?:o\/u|over\/under|total)(?:\s*\(incl\. overtime\))?$/.test(
      name,
    );
  return fullTime || firstHalf || individual;
}

export async function buildLiveSlipSnapshot(
  provider: SportyBetProvider,
  sport: Sport,
  gameCount: number,
  targetOdds?: number,
  todayOnly = false,
): Promise<LiveSlipSnapshot> {
  const count = Math.max(1, Math.min(30, gameCount));
  const now = new Date();
  const lagosDay = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  const today = lagosDay(now);
  const events = (await provider.listEvents(sport))
    .filter(
      (event) =>
        event.status === 'scheduled' &&
        event.startsAt.getTime() > now.getTime() &&
        (!todayOnly || lagosDay(event.startsAt) === today),
    )
    .slice(0, Math.min(30, count * 3));
  const availableLegs = Math.max(1, Math.min(count, events.length));
  const desiredPerLeg = Math.max(1.05, Math.pow(targetOdds ?? 3, 1 / availableLegs));

  const candidates: CandidateSelection[] = [];
  for (let offset = 0; offset < events.length && candidates.length < count;) {
    const batch = events.slice(offset, offset + Math.min(4, count - candidates.length));
    offset += batch.length;
    const results = await Promise.allSettled(
      batch.map(async (event): Promise<CandidateSelection | null> => {
        const markets = (await provider.getMarkets(event.providerEventId)).filter(
          (market) =>
            market.status === 'active' &&
            market.odds > 1.01 &&
            market.sport === sport &&
            (sport !== 'basketball' || isAllowedBasketballOverMarket(market)),
        );
        const market = markets.sort(
          (left, right) =>
            Math.abs(Math.log(left.odds) - Math.log(desiredPerLeg)) -
            Math.abs(Math.log(right.odds) - Math.log(desiredPerLeg)),
        )[0];
        if (!market) return null;
        const impliedProbability = rounded(Math.min(95, 100 / market.odds));
        return {
          ...market,
          fixture: {
            id: event.providerEventId,
            providerId: event.providerEventId,
            sport,
            league: 'SportyBet',
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
            'Chosen as the active price closest to the requested combined-odds profile.',
          ],
        };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) candidates.push(result.value);
    }
  }
  const selections = candidates
    .filter((value): value is CandidateSelection => value !== null)
    .slice(0, count);
  if (selections.length === 0) {
    throw new Error(
      todayOnly
        ? `No supported scheduled ${sport} markets are available today.`
        : `No active scheduled ${sport} markets are available.`,
    );
  }
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
