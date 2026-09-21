import type { RiskMode } from '../types/domain.js';

/** Evidence scores are review quality ratings, NOT calibrated win probabilities. */
export const STRICT_PRESET_QUALITY = 68;
export const STANDARD_QUALITY = { conservative: 60, balanced: 55, aggressive: 50 } as const;

/** Only explicitly requested 2.00 / 5.00 targets use the strict preset threshold. */
export function minimumQualityForTarget(targetOdds?: number | null,
  riskMode: RiskMode = 'balanced'): number {
  if (targetOdds === 2 || targetOdds === 5) return STRICT_PRESET_QUALITY;
  return STANDARD_QUALITY[riskMode];
}
