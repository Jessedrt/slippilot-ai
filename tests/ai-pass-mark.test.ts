import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_AI_QUALITY_SCORE, passesAiQuality } from '../src/ai/quality-gate.js';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import { buildReviewedLiveSlipSnapshot } from '../src/sportybet/market-review.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const provider: SportyBetProvider = {
  name: 'SportyBet',
  listEvents: () =>
    Promise.resolve([
      {
        providerEventId: 'sr:match:1',
        homeTeam: 'Home',
        awayTeam: 'Away',
        startsAt: new Date('2026-09-20T20:00:00Z'),
        status: 'scheduled',
      },
    ]),
  findEvents: () => Promise.resolve([]),
  getEvent: () => Promise.resolve(null),
  getMarkets: () =>
    Promise.resolve([
      {
        eventId: 'sr:match:1',
        providerMarketId: '1',
        providerSelectionId: 'home',
        sport: 'football',
        category: 'Winner',
        marketName: 'Winner',
        selectionName: 'Home',
        odds: 1.5,
        status: 'active',
        lastUpdated: new Date(),
      },
    ]),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TEST123'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
};
const analyzer = (
  confidence: number,
  verdict: 'keep' | 'caution' | 'reject' = 'keep',
): SlipAnalyzer => ({
  analyze: (items) =>
    Promise.resolve({
      model: 'test',
      analyzedAt: new Date().toISOString(),
      summary: 'Evidence quality only.',
      selections: items.map((_item, index) => ({
        index: index + 1,
        confidence,
        statisticalSupport: 'supported' as const,
        risk: 'lower' as const,
        verdict,
        reason: 'Test evidence.',
      })),
    }),
});

describe('AI evidence-quality pass mark', () => {
  it('keeps strict legacy default inclusive at 68 and rejects bad verdicts', () => {
    expect(MIN_AI_QUALITY_SCORE).toBe(68);
    expect(
      passesAiQuality({ confidence: 67, statisticalSupport: 'supported', verdict: 'keep' }),
    ).toBe(false);
    expect(
      passesAiQuality({ confidence: 68, statisticalSupport: 'supported', verdict: 'keep' }),
    ).toBe(true);
    expect(
      passesAiQuality({ confidence: 68, statisticalSupport: 'supported', verdict: 'caution' }),
    ).toBe(false);
    expect(
      passesAiQuality({ confidence: 99, statisticalSupport: 'supported', verdict: 'reject' }),
    ).toBe(false);
    expect(
      passesAiQuality({ confidence: Number.NaN, statisticalSupport: 'supported', verdict: 'keep' }),
    ).toBe(false);
    expect(passesAiQuality({ confidence: 99, verdict: 'keep' })).toBe(false);
  });
  it('never offers scores below 68 for the explicit 2.00 target', async () => {
    await expect(
      buildReviewedLiveSlipSnapshot(provider, analyzer(67), 'football', 1, 2),
    ).rejects.toMatchObject({ statusCode: 409 });
    const exactPass = await buildReviewedLiveSlipSnapshot(provider, analyzer(68), 'football', 1, 2);
    expect(exactPass.slip.selections).toHaveLength(1);
    expect(exactPass.analysis.summary).toContain('pass mark 68/100');
    await expect(
      buildReviewedLiveSlipSnapshot(provider, analyzer(99, 'reject'), 'football', 1, 2),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('uses 55 for the balanced non-preset, without allowing rejected choices', async () => {
    await expect(
      buildReviewedLiveSlipSnapshot(provider, analyzer(54), 'football', 1, 10),
    ).rejects.toMatchObject({ statusCode: 409 });
    const exactPass = await buildReviewedLiveSlipSnapshot(
      provider,
      analyzer(55),
      'football',
      1,
      10,
    );
    expect(exactPass.slip.selections).toHaveLength(1);
    expect(exactPass.analysis.summary).toContain('pass mark 55/100');
  });
});
