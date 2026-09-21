import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_AI_QUALITY_SCORE, minimumAiQualityScore, passesAiQuality } from '../src/ai/quality-gate.js';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import { buildReviewedLiveSlipSnapshot } from '../src/sportybet/market-review.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-20T10:00:00Z')); });
afterEach(() => vi.useRealTimers());

const provider: SportyBetProvider = {
  name: 'SportyBet',
  listEvents: () => Promise.resolve([{ providerEventId: 'sr:match:1',
    homeTeam: 'Home', awayTeam: 'Away',
    startsAt: new Date('2026-09-20T20:00:00Z'), status: 'scheduled' }]),
  findEvents: () => Promise.resolve([]), getEvent: () => Promise.resolve(null),
  getMarkets: () => Promise.resolve([{ eventId: 'sr:match:1', providerMarketId: '1',
    providerSelectionId: 'home', sport: 'football', category: 'Winner',
    marketName: 'Winner', selectionName: 'Home', odds: 1.5,
    status: 'active', lastUpdated: new Date() }]),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TEST123'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
};
const analyzer = (confidence: number, verdict: 'keep' | 'caution' | 'reject' = 'keep'): SlipAnalyzer => ({
  analyze: (items) => Promise.resolve({ model: 'test', analyzedAt: new Date().toISOString(),
    summary: 'Evidence quality only.',
    selections: items.map((_item, index) => ({ index: index + 1, confidence,
      risk: 'lower' as const, verdict, reason: 'Test evidence.' })) }),
});

describe('AI evidence-quality pass mark', () => {
  it('keeps 68 inclusive only for 2.00 and 5.00, with 50–60 for other targets', () => {
    expect(MIN_AI_QUALITY_SCORE).toBe(68);
    for (const odds of [2, 5]) for (const risk of ['conservative', 'balanced', 'aggressive'] as const) {
      expect(minimumAiQualityScore(odds, risk)).toBe(68);
    }
    for (const odds of [1.5, 3, 10, 100, null, undefined]) {
      expect(minimumAiQualityScore(odds, 'conservative')).toBe(60);
      expect(minimumAiQualityScore(odds, 'balanced')).toBe(55);
      expect(minimumAiQualityScore(odds, 'aggressive')).toBe(50);
    }
    expect(passesAiQuality({ confidence: 67, verdict: 'keep' })).toBe(false);
    expect(passesAiQuality({ confidence: 68, verdict: 'keep' })).toBe(true);
    expect(passesAiQuality({ confidence: 55, verdict: 'keep' }, 55)).toBe(true);
    expect(passesAiQuality({ confidence: 54, verdict: 'keep' }, 55)).toBe(false);
    expect(passesAiQuality({ confidence: 68, verdict: 'caution' }, 68)).toBe(true);
    expect(passesAiQuality({ confidence: 99, verdict: 'reject' }, 50)).toBe(false);
    expect(passesAiQuality({ confidence: Number.NaN, verdict: 'keep' }, 50)).toBe(false);
  });

  it('applies the balanced 55 minimum to builds without a strict target', async () => {
    await expect(buildReviewedLiveSlipSnapshot(provider, analyzer(54), 'football', 1))
      .rejects.toMatchObject({ statusCode: 409 });
    const exactPass = await buildReviewedLiveSlipSnapshot(provider, analyzer(55), 'football', 1);
    expect(exactPass.slip.selections).toHaveLength(1);
    expect(exactPass.analysis.selections[0]?.confidence).toBe(55);
    expect(exactPass.analysis.summary).toContain('pass mark 55/100');
    await expect(buildReviewedLiveSlipSnapshot(provider, analyzer(99, 'reject'), 'football', 1))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('retains 68 for the 2.00 preset, including its conservative variant', async () => {
    await expect(buildReviewedLiveSlipSnapshot(provider, analyzer(67), 'football', 1, 2, 'conservative'))
      .rejects.toMatchObject({ statusCode: 409 });
    const exactPass = await buildReviewedLiveSlipSnapshot(provider, analyzer(68), 'football', 1, 2, 'conservative');
    expect(exactPass.slip.selections).toHaveLength(1);
    expect(exactPass.analysis.summary).toContain('pass mark 68/100');
  });
});
