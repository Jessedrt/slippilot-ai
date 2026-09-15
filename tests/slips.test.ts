import { describe, expect, it } from 'vitest';
import { combinedOdds, SlipOptimizer } from '../src/slips/optimizer.js';
import { SlipSplitter } from '../src/slips/splitter.js';
import { candidate } from './fixtures.js';

describe('slip optimizer', () => {
  it('calculates combined decimal odds', () => {
    expect(combinedOdds([candidate(1, 1.5), candidate(2, 2), candidate(3, 1.2)])).toBe(3.6);
  });

  it('uses beam search with confidence and target constraints', () => {
    const result = new SlipOptimizer().optimize({
      candidates: [candidate(1, 1.5, 84), candidate(2, 1.6, 82), candidate(3, 2.8, 52)],
      gameCount: 2,
      targetOdds: 2.4,
      minimumConfidence: 70,
      riskPreference: 'conservative',
    });
    expect(result.selections).toHaveLength(2);
    expect(result.combinedOdds).toBe(2.4);
  });

  it('does not select two markets from the same fixture', () => {
    const same = candidate(2, 1.7, 90, { fixture: candidate(1, 1.5).fixture });
    const result = new SlipOptimizer().optimize({
      candidates: [candidate(1, 1.5), same, candidate(3, 1.4)],
      gameCount: 2,
    });
    expect(new Set(result.selections.map((item) => item.fixture.id)).size).toBe(2);
  });
});

describe('intelligent split', () => {
  it('balances risk and combined odds across groups', () => {
    const result = new SlipSplitter().split(
      [candidate(1, 3, 60), candidate(2, 2.5, 65), candidate(3, 1.3, 85), candidate(4, 1.25, 88)],
      2,
    );
    expect(result).toHaveLength(2);
    expect(result.every((slip) => slip.selections.length === 2)).toBe(true);
    expect(
      Math.max(...result.map((slip) => slip.combinedOdds)) /
        Math.min(...result.map((slip) => slip.combinedOdds)),
    ).toBeLessThan(1.5);
  });
});
