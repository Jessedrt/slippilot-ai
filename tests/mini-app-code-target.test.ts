import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const botToken = '1234567890:test-telegram-token';
function telegramInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'target-check',
    user: JSON.stringify({ id: 123, first_name: 'Test' }),
  });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

describe('Mini App direct target-to-booking-code generation', () => {
  it('never creates a code above the supplied cap, even if changed odds were accepted', async () => {
    const event = { providerEventId: 'event-1', homeTeam: 'Home', awayTeam: 'Away',
      startsAt: new Date(Date.now() + 86_400_000), status: 'scheduled' as const };
    const market: NormalizedMarket = { eventId: 'event-1',
      providerMarketId: 'market-1', providerSelectionId: 'selection-1',
      sport: 'football', category: 'totals', marketName: 'Total',
      selectionName: 'Over 1.5', odds: 1.5, status: 'active', lastUpdated: new Date() };
    const createBookingCode = vi.fn(() => Promise.resolve('NEWCODE'));
    const app = Fastify();
    await app.register(sensible);
    registerMiniAppRoutes(app, {
      telegramBotToken: botToken,
      sportyBet: { name: 'SportyBet',
        listEvents: () => Promise.resolve([event]),
        findEvents: () => Promise.resolve([event]),
        getEvent: () => Promise.resolve(event),
        getMarkets: () => Promise.resolve([market]),
        resolveBookingCode: () => Promise.resolve([]),
        createBookingCode,
        health: () => Promise.resolve({ ok: true, detail: 'test' }) },
      slipAnalyzer: { analyze: (selections) => Promise.resolve({
        model: 'test', analyzedAt: new Date().toISOString(), summary: 'Reviewed.',
        selections: selections.map((_selection, index) => ({ index: index + 1,
          confidence: 80, risk: 'lower' as const,
          verdict: 'keep' as const, reason: 'Verified market.' })) }) },
      screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) },
    });
    try {
      const headers = { 'x-telegram-init-data': telegramInitData() };
      const build = await app.inject({ method: 'POST', url: '/api/miniapp/build',
        headers, payload: { sport: 'football', gameCount: 1, riskMode: 'balanced' } });
      expect(build.statusCode).toBe(200);
      const { selections, analysisToken } = build.json<{
        selections: Array<Record<string, unknown>>; analysisToken: string }>();
      const request = (maximumOdds: number, acceptOddsChange = false) => app.inject({
        method: 'POST', url: '/api/miniapp/code', headers,
        payload: { selections, analysisToken, maximumOdds, acceptOddsChange },
      });
      const rejected = await request(1.4);
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json()).toMatchObject({ status: 'target_exceeded', maximumOdds: 1.4 });
      expect(createBookingCode).not.toHaveBeenCalled();

      const allowed = await request(1.5);
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({ code: 'NEWCODE', odds: 1.5 });
      expect(createBookingCode).toHaveBeenCalledTimes(1);

      market.odds = 1.6;
      const changed = await request(1.5, true);
      expect(changed.statusCode).toBe(409);
      expect(changed.json()).toMatchObject({ status: 'target_exceeded', currentOdds: 1.6 });
      expect(createBookingCode).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
