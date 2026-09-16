import type { Sport } from '../types/domain.js';

export type OddsRiskMode = 'conservative' | 'balanced' | 'aggressive';

/** This is a planning heuristic, not a probability or a promised final price. */
export function automaticLegCount(targetOdds: number, riskMode: unknown = 'balanced'): number {
  if (!Number.isFinite(targetOdds) || targetOdds <= 1) {
    throw new Error('Target odds must be a finite number greater than 1.');
  }
  const preferredLegOdds = riskMode === 'conservative' ? 1.35 : riskMode === 'aggressive' ? 1.8 : 1.55;
  return Math.max(1, Math.ceil(Math.log(targetOdds) / Math.log(preferredLegOdds)));
}

/** Explicitly requested games are optional; odds-first requests choose their own count. */
export function oddsDiscoveryText(sport: Sport, targetOdds: number, riskMode: unknown = 'balanced'): string {
  const count = automaticLegCount(targetOdds, riskMode);
  return `Give me ${count} ${sport} games today near ${targetOdds} odds`;
}
