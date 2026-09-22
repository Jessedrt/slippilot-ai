import { describe, expect, it } from 'vitest';
import { minimumQualityForTarget } from '../src/ai/quality-policy.js';
import { passesAiQuality } from '../src/ai/quality-gate.js';

describe('target-specific evidence quality (not winning probabilities)', () => {
  it('reserves the 68 threshold for exact 2.00 and 5.00 targets', () => {
    for (const odds of [2, 5]) {
      for (const risk of ['conservative', 'balanced', 'aggressive'] as const) {
        expect(minimumQualityForTarget(odds, risk)).toBe(68);
        expect(
          passesAiQuality(
            { confidence: 67, statisticalSupport: 'supported', verdict: 'keep' },
            minimumQualityForTarget(odds, risk),
          ),
        ).toBe(false);
        expect(
          passesAiQuality(
            { confidence: 68, statisticalSupport: 'supported', verdict: 'keep' },
            minimumQualityForTarget(odds, risk),
          ),
        ).toBe(true);
      }
    }
  });
  it('uses 60 conservative, 55 balanced, 50 aggressive for other odds', () => {
    for (const odds of [1.99, 2.01, 3, 4.99, 5.01, 10, 150, undefined]) {
      expect(minimumQualityForTarget(odds, 'conservative')).toBe(60);
      expect(minimumQualityForTarget(odds, 'balanced')).toBe(55);
      expect(minimumQualityForTarget(odds, 'aggressive')).toBe(50);
    }
  });
  it('rejects scores below each minimum, rejected verdicts and invalid scores', () => {
    for (const min of [50, 55, 60, 68]) {
      expect(
        passesAiQuality(
          { confidence: min - 1, statisticalSupport: 'supported', verdict: 'keep' },
          min,
        ),
      ).toBe(false);
      expect(
        passesAiQuality({ confidence: min, statisticalSupport: 'supported', verdict: 'keep' }, min),
      ).toBe(true);
      expect(
        passesAiQuality(
          { confidence: 99, statisticalSupport: 'supported', verdict: 'reject' },
          min,
        ),
      ).toBe(false);
      expect(
        passesAiQuality({ confidence: NaN, statisticalSupport: 'supported', verdict: 'keep' }, min),
      ).toBe(false);
    }
  });
});
