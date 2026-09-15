import type { CandidateSelection, DataQuality, RiskLevel } from '../types/domain.js';

export interface ConfidenceInput {
  probability: number;
  dataCompleteness: number;
  sampleSize: number;
  marketVariance: number;
}

export interface ConfidenceResult {
  modelProbability: number;
  confidenceScore: number;
  dataQuality: DataQuality;
  riskLevel: RiskLevel;
}

export class ConfidenceEngine {
  calculate(input: ConfidenceInput): ConfidenceResult {
    const probability = Math.min(99, Math.max(1, input.probability));
    const completeness = Math.min(1, Math.max(0, input.dataCompleteness));
    const sampleFactor = Math.min(1, Math.max(0, input.sampleSize / 10));
    const qualityScore = completeness * 0.7 + sampleFactor * 0.3;
    const confidenceScore = Math.round((probability / 100) * qualityScore * 100) / 10;
    return {
      modelProbability: probability,
      confidenceScore,
      dataQuality: qualityScore >= 0.8 ? 'high' : qualityScore >= 0.55 ? 'medium' : 'low',
      riskLevel:
        input.marketVariance <= 0.3 && probability >= 70
          ? 'lower'
          : input.marketVariance >= 0.7 || probability < 55
            ? 'higher'
            : 'medium',
    };
  }
}

export function averageConfidence(items: CandidateSelection[]): number {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item.modelProbability, 0) / items.length;
}
