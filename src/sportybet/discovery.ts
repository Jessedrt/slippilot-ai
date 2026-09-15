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

export async function buildLiveSlipSnapshot(
  provider: SportyBetProvider,
  sport: Sport,
  gameCount: number,
  targetOdds?: number,
): Promise<LiveSlipSnapshot> {
  const count = Math.max(1, Math.min(30, gameCount));
  const desiredPerLeg = Math.max(1.05, Math.pow(targetOdds ?? 3, 1 / count));
  const events = (await provider.listEvents(sport))
    .filter((event) => event.status === 'scheduled' && event.startsAt.getTime() > Date.now())
    .slice(0, Math.min(30, count * 3));

  const candidates = await Promise.all(
    events.map(async (event): Promise<CandidateSelection | null> => {
      const markets = (await provider.getMarkets(event.providerEventId)).filter(
        (market) => market.status === 'active' && market.odds > 1.01 && market.sport === sport,
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
  const selections = candidates
    .filter((value): value is CandidateSelection => value !== null)
    .slice(0, count);
  if (selections.length === 0)
    throw new Error(`No active scheduled ${sport} markets are available.`);
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
