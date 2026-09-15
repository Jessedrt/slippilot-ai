import { averageConfidence } from '../analysis/confidence-engine.js';
import type { CandidateSelection } from '../types/domain.js';
import { combinedOdds } from './optimizer.js';

export interface SplitResult {
  selections: CandidateSelection[];
  combinedOdds: number;
  averageConfidence: number;
}

export class SlipSplitter {
  split(selections: CandidateSelection[], groups: number): SplitResult[] {
    if (!Number.isInteger(groups) || groups < 2 || groups > selections.length) {
      throw new Error('Split count must be between 2 and the number of selections.');
    }
    const buckets: CandidateSelection[][] = Array.from({ length: groups }, () => []);
    const sorted = [...selections].sort(
      (a, b) => b.odds * (101 - b.modelProbability) - a.odds * (101 - a.modelProbability),
    );
    for (const selection of sorted) {
      const bucket = buckets
        .map((items, index) => ({ items, index, odds: combinedOdds(items) }))
        .sort((a, b) => a.odds - b.odds || a.items.length - b.items.length)[0];
      bucket?.items.push(selection);
    }
    return buckets.map((items) => ({
      selections: items,
      combinedOdds: combinedOdds(items),
      averageConfidence: Math.round(averageConfidence(items) * 10) / 10,
    }));
  }
}
