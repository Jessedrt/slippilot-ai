import { STRICT_PRESET_QUALITY } from './quality-policy.js';

/** Evidence quality score, not a calibrated win probability. Legacy default for callers
 * without a target context remains strict to avoid silently loosening unknown routes. */
export const MIN_AI_QUALITY_SCORE = STRICT_PRESET_QUALITY;

export function passesAiQuality(review: { confidence: number; verdict: string },
  minimum = MIN_AI_QUALITY_SCORE): boolean {
  return Number.isFinite(minimum) && minimum >= 50 && minimum <= 68 &&
    review.verdict !== 'reject' && Number.isFinite(review.confidence) &&
    review.confidence >= minimum && review.confidence <= 100;
}
