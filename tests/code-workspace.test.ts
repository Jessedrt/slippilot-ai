import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import { registerCodeWorkspaceRoutes } from '../src/api/code-workspace-routes.js';
import { registerCodeMarketOptions } from '../src/api/code-market-options.js';
import { registerSlipEditorRoutes } from '../src/api/slip-editor-routes.js';
import type { SportyBetProvider, ProviderSelection } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const token = '1234567890:aurex-code-workspace-test';
const now = new Date('2026-09-18T10:00:00Z');
function initData(userId = 42) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `edit-${userId}`, user: JSON.stringify({ id: userId }) });
  const signed = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(signed).digest('hex'));
  return params.toString();
}
const fixture = (id: string) => ({ providerEventId: id,
  homeTeam: `Home ${id}`, awayTeam: `Away ${id}`, league: 'Test League',
  startsAt: new Date('2026-09-19T18:00:00Z'), status: 'scheduled' as const });
const market = (eventId: string, marketId: string, selectionId: string, odds: number): NormalizedMarket => ({
  eventId, providerMarketId: marketId, providerSelectionId: selectionId,
  sport: 'football', category: 'goals', marketName: `Total ${marketId}`,
  selectionName: `Over ${selectionId}`, odds, status: 'active', lastUpdated: now,
});
const selections: ProviderSelection[] = [
  { eventId: 'e1', marketId: 'm1', selectionId: 's1', odds: 1.4 },
  { eventId: 'e2', marketId: 'm3', selectionId: 's3', odds: 1.6 },
];
function dependencies() {
  const all = [fixture('e1'), fixture('e2')];
  const prices = [market('e1', 'm1', 's1', 1.45), market('e1', 'm2', 's2', 1.85),
    market('e2', 'm3', 's3', 1.65)];
  const createCode = vi.fn<SportyBetProvider['createBookingCode']>()
    .mockResolvedValue('NEWCODE123');
  const provider: SportyBetProvider = { name: 'SportyBet',
    listEvents: () => Promise.resolve(all), findEvents: () => Promise.resolve(all),
    getEvent: (id) => Promise.resolve(all.find((item) => item.providerEventId === id) ?? null),
    getMarkets: (id) => Promise.resolve(prices.filter((item) => item.eventId === id)),
    resolveBookingCode: () => Promise.resolve(selections), createBookingCode: createCode,
    health: () => Promise.resolve({ ok: true, detail: 'test' }) };
  const analyze = vi.fn((items: NormalizedMarket[]) => Promise.resolve({
    model: 'test', analyzedAt: now.toISOString(), summary: 'Every market verified.',
    selections: items.map((_item, index) => ({ index: index + 1,
      confidence: 70, risk: 'medium' as const, verdict: 'keep' as const,
      reason: 'Provider price checked; lineups unavailable.' })) }));
  const deps = { sportyBet: provider, telegramBotToken: token, slipAnalyzer: { analyze },
    screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) } };
  return { deps, analyze, createCode };
}
afterEach(() => vi.useRealTimers());
describe('verified imported booking-code editor', () => {
  it('authenticates import, compares actual options, chooses a specific market, trims and creates a new code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(now);
    const { deps, analyze, createCode } = dependencies();
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, deps);
    registerCodeWorkspaceRoutes(app, deps);
    registerCodeMarketOptions(app, deps.sportyBet);
    registerSlipEditorRoutes(app, deps);
    try {
      const unauthorized = await app.inject({ method: 'POST', url: '/api/miniapp/import-code',
        payload: { code: 'ABCD1234' } });
      expect(unauthorized.statusCode).toBe(401);
      const headers = { 'x-telegram-init-data': initData() };
      const imported = await app.inject({ method: 'POST', url: '/api/miniapp/import-code',
        headers, payload: { code: 'ABCD1234' } });
      expect(imported.statusCode).toBe(200);
      const importedData = imported.json<{ editableSlip: { selections: Array<{
        eventId: string; marketId: string; selectionId: string; odds: number }>;
        analysisToken: string }; count: number; combinedOdds: number }>();
      expect(importedData.count).toBe(2);
      expect(importedData.combinedOdds).toBeCloseTo(1.45 * 1.65);
      expect(importedData.editableSlip.selections).toHaveLength(2);
      expect(analyze).toHaveBeenCalledOnce();
      const options = await app.inject({ method: 'POST', url: '/api/miniapp/code-options',
        headers, payload: { eventId: 'e1', sport: 'football' } });
      expect(options.statusCode).toBe(200);
      expect(options.json<{ options: Array<{ marketId: string }> }>().options.map((item) => item.marketId))
        .toEqual(['m1', 'm2']);
      const forged = await app.inject({ method: 'POST', url: '/api/miniapp/edit-slip',
        headers, payload: { action: 'choose', index: 0, marketId: 'm2', selectionId: 's2',
          selections: importedData.editableSlip.selections.map((item) => ({ ...item, eventId: 'forged' })),
          analysisToken: importedData.editableSlip.analysisToken } });
      expect(forged.statusCode).toBe(401);
      const changed = await app.inject({ method: 'POST', url: '/api/miniapp/edit-slip',
        headers, payload: { action: 'choose', index: 0, marketId: 'm2', selectionId: 's2',
          selections: importedData.editableSlip.selections,
          analysisToken: importedData.editableSlip.analysisToken } });
      expect(changed.statusCode).toBe(200);
      const changedData = changed.json<{ selections: Array<{ marketId: string; odds: number }>;
        analysisToken: string }>();
      expect(changedData.selections[0]).toMatchObject({ marketId: 'm2', odds: 1.85 });
      expect(analyze).toHaveBeenCalledTimes(2);
      const trimmed = await app.inject({ method: 'POST', url: '/api/miniapp/edit-slip',
        headers, payload: { action: 'reanalyze',
          selections: changedData.selections.slice(0, 1), analysisToken: changedData.analysisToken } });
      expect(trimmed.statusCode).toBe(200);
      const trimmedData = trimmed.json<{ selections: unknown[]; analysisToken: string }>();
      expect(trimmedData.selections).toHaveLength(1);
      expect(analyze).toHaveBeenCalledTimes(3);
      const booking = await app.inject({ method: 'POST', url: '/api/miniapp/code', headers,
        payload: { selections: trimmedData.selections, analysisToken: trimmedData.analysisToken } });
      expect(booking.statusCode).toBe(200);
      expect(booking.json<{ code: string }>().code).toBe('NEWCODE123');
      expect(createCode).toHaveBeenCalledOnce();
      const otherSession = await app.inject({ method: 'POST', url: '/api/miniapp/code',
        headers: { 'x-telegram-init-data': initData(99) },
        payload: { selections: trimmedData.selections, analysisToken: trimmedData.analysisToken } });
      expect(otherSession.statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it('refuses a code when the provider cannot verify unique active markets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(now);
    const { deps, analyze } = dependencies();
    deps.sportyBet.getMarkets = () => Promise.resolve([]);
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, deps); registerCodeWorkspaceRoutes(app, deps);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/miniapp/import-code',
        headers: { 'x-telegram-init-data': initData() }, payload: { code: 'ABCD1234' } });
      expect(response.statusCode).not.toBe(200);
      expect(analyze).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
