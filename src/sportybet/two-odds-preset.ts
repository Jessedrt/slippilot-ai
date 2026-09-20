import type { SlipAnalysis } from '../ai/slip-analyzer.js';
import type { CandidateSelection } from '../types/domain.js';

export interface TwoOddsChoice {
  candidate: CandidateSelection;
  review: SlipAnalysis['selections'][number];
}

const lagosHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23',
});

/**
 * A conservative shortlist, NOT a probability forecast. Odds contain the
 * bookmaker's margin; model confidence describes evidence quality, not wins.
 * Never add caution/higher-risk picks merely to reach the requested 2.00 odds.
 */
export function selectTwoOddsPicks<T extends TwoOddsChoice>(
  choices: T[], requestedCount: number, targetPerLeg: number,
): T[] {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) return [];
  const eligible = choices.filter(({ candidate, review }) =>
    review.verdict === 'keep' && review.risk === 'lower' &&
    Number.isFinite(review.confidence) && review.confidence >= 0 &&
    Number.isFinite(candidate.odds) && candidate.odds > 1.01);
  const score = ({ candidate, review }: T) =>
    review.confidence + 35 / candidate.odds -
    15 * Math.max(0, Math.log(candidate.odds / targetPerLeg));
  const windows = new Map<number, T[]>();
  for (const choice of eligible) {
    const hour = Number(lagosHour.format(choice.candidate.fixture.startsAt));
    const window = Math.floor(hour / 4);
    const group = windows.get(window) ?? [];
    group.push(choice);
    windows.set(window, group);
  }
  const groups = [...windows.entries()]
    .map(([window, picks]) => ({ window, picks: picks.sort((a, b) =>
      score(b) - score(a) || a.candidate.odds - b.candidate.odds ||
      a.candidate.eventId.localeCompare(b.candidate.eventId)) }))
    .sort((a, b) => score(b.picks[0]!) - score(a.picks[0]!) || a.window - b.window);
  const selected: T[] = [];
  // Rotate across available kickoff windows, but only through independently
  // reviewed lower-risk selections. Empty windows cannot force a pick.
  while (selected.length < requestedCount) {
    let added = false;
    for (const group of groups) {
      const next = group.picks.shift();
      if (!next) continue;
      selected.push(next);
      added = true;
      if (selected.length >= requestedCount) break;
    }
    if (!added) break;
  }
  return selected;
}
