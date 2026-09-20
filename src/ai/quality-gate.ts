/** Minimum evidence-quality score for a pick to qualify for AUREX slips.
 * These scores are NOT calibrated probabilities of winning.
 */
export const MIN_AI_QUALITY_SCORE = 68;

export function passesAiQuality(review: { confidence: number; verdict: string }): boolean {
  return review.verdict !== 'reject' && Number.isFinite(review.confidence) &&
    review.confidence >= MIN_AI_QUALITY_SCORE && review.confidence <= 100;
}
