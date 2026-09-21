/** Evidence-quality scores are NOT calibrated winning probabilities. */
export const MIN_AI_QUALITY_SCORE = 68;
export const STANDARD_AI_QUALITY_SCORE = 55;
export type QualityRiskMode = 'conservative' | 'balanced' | 'aggressive';

/** Only the exact 2.00 and 5.00 target-odds presets require 68/100.
 * Other targets have a 50–60/100 quality minimum based on the selected risk mode.
 * A missing target (such as a pasted code) uses the balanced 55/100 minimum.
 */
export function minimumAiQualityScore(
  targetOdds?: number | null,
  riskMode: QualityRiskMode = 'balanced',
): number {
  if (targetOdds === 2 || targetOdds === 5) return MIN_AI_QUALITY_SCORE;
  if (riskMode === 'conservative') return 60;
  if (riskMode === 'aggressive') return 50;
  return STANDARD_AI_QUALITY_SCORE;
}

/** The default remains strict for callers that do not provide an explicit policy. */
export function passesAiQuality(
  review: { confidence: number; verdict: string },
  minimumScore: number = MIN_AI_QUALITY_SCORE,
): boolean {
  return review.verdict !== 'reject' && Number.isFinite(review.confidence) &&
    review.confidence >= minimumScore && review.confidence <= 100;
}
