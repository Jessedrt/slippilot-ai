import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Pick = { id: string; confidence: number; odds: number; risk: 'lower' | 'medium' | 'higher' };
type TrimResult = { ok: boolean; selections?: Pick[]; removed?: number; combinedOdds?: number; reason?: string };
const sandbox: { AurexScoreTrim?: {
  rankByScore: (items: Pick[]) => Pick[];
  selectForTarget: (items: Pick[], target: number) => TrimResult;
} } = {};
runInNewContext(readFileSync(new URL('../public/app/score-trim.js', import.meta.url), 'utf8'), sandbox);
const ranking = sandbox.AurexScoreTrim!;
const picks: Pick[] = [
  { id: 'weak', confidence: 56, odds: 2, risk: 'higher' },
  { id: 'strong', confidence: 91, odds: 3, risk: 'lower' },
  { id: 'middle', confidence: 76, odds: 4, risk: 'medium' },
];
const ids = (result: TrimResult) => result.selections?.map((item) => item.id);

describe('AUREX score-first trimming', () => {
  it('sorts reviewed games highest to lowest without mutating the original slip', () => {
    expect(ranking.rankByScore(picks).map((item) => item.id)).toEqual(['strong', 'middle', 'weak']);
    expect(picks[0]?.id).toBe('weak');
  });
  it('retains higher-scored picks first and skips expensive legs that cannot fit', () => {
    const result = ranking.selectForTarget(picks, 6);
    expect(result.ok).toBe(true);
    expect(ids(result)).toEqual(['strong', 'weak']);
    expect(result.removed).toBe(1);
    expect(result.combinedOdds).toBe(6);
  });
  it.each([2, 5, 10, 40, 100])('accepts an arbitrary %i-odds target with no 40 preset', (target) => {
    const result = ranking.selectForTarget(picks, target);
    expect(result.ok).toBe(true);
    expect(result.combinedOdds).toBeLessThanOrEqual(target + 0.000001);
    const scores = result.selections!.map((pick) => pick.confidence);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  it('preserves all verified picks sorted when the target exceeds current slip odds', () => {
    const result = ranking.selectForTarget(picks, 100);
    expect(ids(result)).toEqual(['strong', 'middle', 'weak']);
    expect(result.removed).toBe(0);
    expect(result.combinedOdds).toBe(24);
  });
  it('does not fabricate a leg or code when none fit a small target', () => {
    expect(ranking.selectForTarget(picks, 1.5)).toMatchObject({
      ok: false, reason: 'no_feasible_pick',
    });
    expect(ranking.selectForTarget(picks, Number.NaN).ok).toBe(false);
    expect(ranking.selectForTarget([], 20).ok).toBe(false);
  });
  it('resolves equal-score ties by documented risk and then lower odds', () => {
    const ties: Pick[] = [
      { id: 'medium', confidence: 78, odds: 1.5, risk: 'medium' },
      { id: 'lower-odds', confidence: 78, odds: 1.6, risk: 'lower' },
      { id: 'higher-odds', confidence: 78, odds: 1.9, risk: 'lower' },
    ];
    expect(ranking.rankByScore(ties).map((pick) => pick.id))
      .toEqual(['lower-odds', 'higher-odds', 'medium']);
  });
});
