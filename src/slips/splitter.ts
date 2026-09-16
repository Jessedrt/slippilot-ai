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
    const targetSize = selections.length / groups;
    const targetLogOdds = selections.reduce((sum, item) => sum + Math.log(item.odds), 0) / groups;
    const targetConfidence = averageConfidence(selections);
    for (const selection of sorted) {
      const bucket = buckets
        .map((items, index) => {
          const next = [...items, selection];
          const logOdds = next.reduce((sum, item) => sum + Math.log(item.odds), 0);
          const sameLeague = items.filter(
            (item) => item.fixture.league === selection.fixture.league,
          ).length;
          const sameSport = items.filter((item) => item.sport === selection.sport).length;
          const closeKickoffs = items.filter(
            (item) =>
              Math.abs(item.fixture.startsAt.getTime() - selection.fixture.startsAt.getTime()) <
              7_200_000,
          ).length;
          const risk = next.reduce(
            (sum, item) => sum + { lower: 0, medium: 0.5, higher: 1 }[item.riskLevel],
            0,
          );
          const score =
            Math.abs(logOdds - targetLogOdds) * 3 +
            Math.abs(next.length - targetSize) * 2 +
            Math.abs(averageConfidence(next) - targetConfidence) / 10 +
            sameLeague * 1.2 +
            sameSport * 0.15 +
            closeKickoffs * 0.8 +
            risk * 0.2;
          return { items, index, score };
        })
        .sort((a, b) => a.score - b.score || a.items.length - b.items.length)[0];
      bucket?.items.push(selection);
    }
    return buckets.map((items) => ({
      selections: items,
      combinedOdds: combinedOdds(items),
      averageConfidence: Math.round(averageConfidence(items) * 10) / 10,
    }));
  }
}
