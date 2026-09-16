import { describe, expect, it } from 'vitest';
import { automaticLegCount, oddsDiscoveryText } from '../src/slips/odds-target.js';
import { deterministicParse } from '../src/ai/intent-parser.js';

describe('odds-first discovery planning', () => {
  it('derives the selection count from total odds and risk preference', () => {
    expect(automaticLegCount(5)).toBeGreaterThan(1);
    expect(automaticLegCount(20, 'conservative')).toBeGreaterThan(automaticLegCount(20, 'aggressive'));
    expect(automaticLegCount(1.1)).toBe(1);
  });

  it('does not impose the former 12-leg cap', () => {
    expect(automaticLegCount(100_000)).toBeGreaterThan(12);
  });

  it('preserves requested sport, odds, today-only intent and computed count', () => {
    const message = oddsDiscoveryText('basketball', 20, 'balanced');
    const parsed = deterministicParse(message);
    expect(parsed.action).toBe('discover');
    expect(parsed.sport).toBe('basketball');
    expect(parsed.targetOdds).toBe(20);
    expect(parsed.gameCount).toBe(automaticLegCount(20));
    expect(message).toContain('today');
  });

  it('rejects invalid target odds rather than generating a game count', () => {
    expect(() => automaticLegCount(Number.NaN)).toThrow();
    expect(() => automaticLegCount(1)).toThrow();
  });
});
