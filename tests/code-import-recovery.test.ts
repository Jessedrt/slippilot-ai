import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import { registerCodeWorkspaceRoutes } from '../src/api/code-workspace-routes.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const botToken = '1234567890:aurex-import-recovery';
const now = new Date('2026-09-18T10:00:00Z');
function auth() {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'old-code', user: JSON.stringify({ id: 22 }) });
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}
const fixture = (id: string, startsAt: string) => ({ providerEventId: id,
  homeTeam: `Home ${id}`, awayTeam: `Away ${id}`,
  league: 'Test League', startsAt: new Date(startsAt), status: 'scheduled' as const });
const oldFixture = fixture('expired', '2026-09-17T18:00:00Z');
const activeFixture = fixture('active', '2026-09-19T18:00:00Z');
function setup(allExpired = false) {
  const analyze = vi.fn((selections: unknown[]) => Promise.resolve({ model: 'test',
    analyzedAt: now.toISOString(), summary: 'Verified active selections.',
    selections: selections.map((_selection, index) => ({ index: index + 1,
      confidence: 56, verdict: 'keep' as const, risk: 'medium' as const,
      reason: 'Provider-backed selection.' })) }));
  const sportyBet: SportyBetProvider = {
    name: 'SportyBet', listEvents: () => Promise.resolve([]),
    findEvents: () => Promise.resolve([]),
    getEvent: (id) => Promise.resolve(id === 'expired' ? oldFixture : allExpired ? oldFixture : activeFixture),
    getMarkets: (id) => Promise.resolve([{ eventId: id, providerMarketId: 'm',
      providerSelectionId: 's', sport: 'football', category: 'Total',
      marketName: 'Total goals', selectionName: 'Over 1.5', odds: 1.55,
      status: 'active' as const, lastUpdated: now }]),
    resolveBookingCode: () => Promise.resolve(['expired', 'active'].map((eventId) => ({
      eventId, marketId: 'm', selectionId: 's', odds: 1.55 }))),
    createBookingCode: () => Promise.resolve('TEST123'),
    health: () => Promise.resolve({ ok: true, detail: 'test' }),
  };
  return { deps: { sportyBet, telegramBotToken: botToken, slipAnalyzer: { analyze },
    screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) } }, analyze };
}
afterEach(() => vi.useRealTimers());
describe('booking code with expired fixtures', () => {
  it('analyzes remaining active legs, reports exclusions, and signs only active selections', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(now);
    const { deps, analyze } = setup();
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, deps); registerCodeWorkspaceRoutes(app, deps);
    try {
      const result = await app.inject({ method: 'POST', url: '/api/miniapp/import-code',
        headers: { 'x-telegram-init-data': auth() }, payload: { code: 'VALID123' } });
      expect(result.statusCode).toBe(200);
      const output = result.json();
      expect(output.originalCount).toBe(2);
      expect(output.count).toBe(1);
      expect(output.excluded).toHaveLength(1);
      expect(output.excluded[0].eventId).toBe('expired');
      expect(output.editableSlip.selections).toHaveLength(1);
      expect(output.editableSlip.selections[0].eventId).toBe('active');
      expect(output.minimumQualityScore).toBe(55);
      expect(analyze).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
  it('returns a helpful conflict rather than a 500 when every fixture has expired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(now);
    const { deps, analyze } = setup(true);
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, deps); registerCodeWorkspaceRoutes(app, deps);
    try {
      const result = await app.inject({ method: 'POST', url: '/api/miniapp/import-code',
        headers: { 'x-telegram-init-data': auth() }, payload: { code: 'OLD1234' } });
      expect(result.statusCode).toBe(409);
      expect(result.json().message).toContain('All 2 selections');
      expect(analyze).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
