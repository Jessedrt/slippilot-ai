import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { importBookingCode } from '../src/api/code-workspace-routes.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const now = new Date('2026-09-21T10:00:00Z');
const token = '123456789:mock-telegram-token';
const pick = (id: string) => ({ eventId: id, marketId: 'm1', selectionId: 's1', odds: 1.5 });
function setup(confidence = 55, valid = true) {
  const analyze = vi.fn((items: unknown[]) => Promise.resolve({ model: 'test',
    analyzedAt: now.toISOString(), summary: 'Actual provider data reviewed.',
    selections: items.map((_item, index) => ({ index: index + 1, confidence,
      verdict: 'keep' as const, risk: 'lower' as const, reason: 'Reviewed.' })) }));
  const provider: SportyBetProvider = {
    name: 'SportyBet', listEvents: () => Promise.resolve([]), findEvents: () => Promise.resolve([]),
    getEvent: (id) => Promise.resolve({ providerEventId: id, homeTeam: `Home ${id}`,
      awayTeam: `Away ${id}`, startsAt: id === 'expired' || !valid
        ? new Date('2026-09-20T18:00:00Z') : new Date('2026-09-22T18:00:00Z'),
      status: 'scheduled' }),
    getMarkets: (id) => Promise.resolve([{ eventId: id, providerMarketId: 'm1',
      providerSelectionId: 's1', sport: 'football', category: 'winner',
      marketName: 'Winner', selectionName: 'Home', odds: 1.5, status: 'active',
      lastUpdated: now }]),
    resolveBookingCode: () => Promise.resolve([pick('expired'), pick('upcoming')]),
    createBookingCode: () => Promise.resolve('NEWCODE'),
    health: () => Promise.resolve({ ok: true, detail: 'test' }),
  };
  return { deps: { sportyBet: provider, slipAnalyzer: { analyze }, telegramBotToken: token }, analyze };
}
afterEach(() => vi.useRealTimers());
describe('booking code import recovery', () => {
  it('discloses started legs, analyzes only current markets and signs 55 minimum', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { deps, analyze } = setup();
    const result = await importBookingCode('ABCD1234', deps, 'verified-init-data');
    expect(result.count).toBe(2);
    expect(result.analyzedCount).toBe(1);
    expect(result.excluded).toMatchObject([{ index: 1, eventId: 'expired' }]);
    expect(result.selections).toHaveLength(1);
    expect(result.editableSlip?.selections).toHaveLength(1);
    expect(result.editableSlip?.qualityMinimum).toBe(55);
    expect(analyze).toHaveBeenCalledOnce();
    const claim = z.object({ minimumScore: z.number(), selections: z.array(z.string()) })
      .parse(JSON.parse(Buffer.from(result.editableSlip!.analysisToken.split('.')[0]!, 'base64url').toString('utf8')) as unknown);
    expect(claim.minimumScore).toBe(55);
    expect(claim.selections).toHaveLength(1);
  });
  it('returns higher-scored verified legs first, including in the signed editable slip', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { deps, analyze } = setup();
    vi.spyOn(deps.sportyBet, 'resolveBookingCode')
      .mockResolvedValue([pick('lower-score'), pick('higher-score')]);
    analyze.mockImplementation((items) => Promise.resolve({
      model: 'test', analyzedAt: now.toISOString(), summary: 'Ranked.',
      selections: items.map((_item, index) => ({ index: index + 1,
        confidence: index === 0 ? 60 : 92,
        verdict: 'keep' as const, risk: 'lower' as const, reason: 'Reviewed.' })),
    }));
    const result = await importBookingCode('ABCD1234', deps, 'verified-init-data');
    expect(result.selections.map((item) => item.eventId))
      .toEqual(['higher-score', 'lower-score']);
    expect(result.editableSlip?.selections.map((item) => item.eventId))
      .toEqual(['higher-score', 'lower-score']);
    const tokenPayload = JSON.parse(Buffer.from(result.editableSlip!.analysisToken.split('.')[0]!,
      'base64url').toString('utf8')) as { selections: string[] };
    expect(tokenPayload.selections[0]).toContain('higher-score');
  });
  it('returns actionable conflict rather than HTTP 500 when all legs have started', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { deps, analyze } = setup(70, false);
    await expect(importBookingCode('ABCD1234', deps, 'verified-init-data'))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(analyze).not.toHaveBeenCalled();
  });
  it('shows reviewed low-quality selection but never offers it for editing', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const { deps } = setup(54);
    const result = await importBookingCode('ABCD1234', deps, 'verified-init-data');
    expect(result.selections).toHaveLength(1);
    expect(result.editableSlip).toBeNull();
  });
});
