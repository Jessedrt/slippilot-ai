import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { registerDeskRoutes } from '../src/api/desk-routes.js';
import { registerIntelligenceRoutes } from '../src/api/intelligence-routes.js';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const botToken = '1234567890:aurex-52-fixture-tests';
const today = new Date('2026-09-18T10:00:00Z');
const upcoming = { providerEventId: 'event-1', league: 'Premier League',
  homeTeam: 'Arsenal', awayTeam: 'Brighton',
  startsAt: new Date('2026-09-18T11:00:00Z'), status: 'scheduled' as const };
const tonight = { ...upcoming, providerEventId: 'event-2', league: 'La Liga',
  homeTeam: 'Madrid', awayTeam: 'Sevilla', startsAt: new Date('2026-09-18T19:00:00Z') };
const live = { ...upcoming, providerEventId: 'event-3', homeTeam: 'City', awayTeam: 'Chelsea',
  startsAt: new Date('2026-09-18T09:00:00Z'), status: 'live' as const };
const tomorrow = { ...upcoming, providerEventId: 'event-4',
  startsAt: new Date('2026-09-19T11:00:00Z') };
const markets: NormalizedMarket[] = [
  { providerMarketId: 'm-1', providerSelectionId: 's-1', eventId: 'event-1',
    sport: 'football', category: 'winner', marketName: 'Match winner', selectionName: 'Arsenal',
    odds: 1.7, status: 'active', lastUpdated: new Date(today.getTime() - 30_000) },
  { providerMarketId: 'm-2', providerSelectionId: 's-2', eventId: 'event-1',
    sport: 'football', category: 'total', marketName: 'Total goals', selectionName: 'Over 1.5',
    odds: 1.35, status: 'active', lastUpdated: new Date(today.getTime() - 11 * 60_000) },
  { providerMarketId: 'm-3', providerSelectionId: 's-3', eventId: 'event-1',
    sport: 'football', category: 'total', marketName: 'Total goals', selectionName: 'Under 1.5',
    odds: 2.2, status: 'suspended', lastUpdated: today },
];
const provider: SportyBetProvider = {
  name: 'SportyBet', listEvents: () => Promise.resolve([tomorrow, upcoming, tonight, live]),
  findEvents: () => Promise.resolve([upcoming]),
  getEvent: (id) => Promise.resolve(id === 'event-1' ? upcoming : null),
  getMarkets: (id) => Promise.resolve(id === 'event-1' ? markets : []),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TESTCODE'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
};
function telegramAuth(queryId = 'intelligence-test') {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: queryId, user: JSON.stringify({ id: 135 }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}
function slipToken(initData: string, selections: Array<{ eventId: string; marketId: string; selectionId: string }>) {
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + 60_000,
    session: createHash('sha256').update(initData).digest('base64url'),
    selections: selections.map((item) => `${item.eventId}\u0000${item.marketId}\u0000${item.selectionId}`),
  })).toString('base64url');
  const signature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
const slip = { eventId: 'event-1', marketId: 'm-1', selectionId: 's-1',
  sport: 'football', odds: 1.65 };

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(today); });
afterEach(() => vi.useRealTimers());

async function setup() {
  const app = Fastify();
  await app.register(sensible);
  registerMiniAppRoutes(app, { sportyBet: provider, telegramBotToken: botToken,
    slipAnalyzer: { analyze: () => Promise.reject(new Error('Not used in this test')) },
    screenshotAnalyzer: { analyze: () => Promise.reject(new Error('Not used in this test')) },
  });
  registerDeskRoutes(app, provider);
  registerIntelligenceRoutes(app, { sportyBet: provider, telegramBotToken: botToken });
  // Production createServer maps Zod validation errors to 400 and respects sensible 401s.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.status(400).send({ message: error.message });
    const failure = error as Error & { statusCode?: number };
    return reply.status(failure.statusCode ?? 500).send({ message: failure.message });
  });
  return app;
}

describe('AUREX 5.2 intelligence', () => {
  it('requires Telegram auth and searches the full provider feed before limiting results', async () => {
    const app = await setup();
    try {
      const denied = await app.inject({ method: 'POST', url: '/api/miniapp/compare-markets',
        payload: { eventId: 'event-1', sport: 'football' } });
      expect(denied.statusCode).toBe(401);
      const headers = { 'x-telegram-init-data': telegramAuth() };
      const query = await app.inject({ method: 'POST', url: '/api/miniapp/fixtures', headers,
        payload: { sport: 'football', query: 'madrid', league: 'La Liga',
          status: 'scheduled', kickoff: 'evening' } });
      expect(query.statusCode).toBe(200);
      expect(query.json<{ fixtures: Array<{ id: string }>; totalMatching: number }>())
        .toMatchObject({ totalMatching: 1, fixtures: [{ id: 'event-2' }] });
      const early = await app.inject({ method: 'POST', url: '/api/miniapp/fixtures', headers,
        payload: { sport: 'football', status: 'scheduled', kickoff: 'next3h' } });
      expect(early.json<{ fixtures: Array<{ id: string }> }>().fixtures.map((item) => item.id))
        .toEqual(['event-1']);
      const invalid = await app.inject({ method: 'POST', url: '/api/miniapp/fixtures', headers,
        payload: { sport: 'football', kickoff: 'next-year' } });
      expect(invalid.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it('compares only real active markets and marks absent selections and stale timestamps', async () => {
    const app = await setup();
    try {
      const headers = { 'x-telegram-init-data': telegramAuth() };
      const response = await app.inject({ method: 'POST', url: '/api/miniapp/compare-markets', headers,
        payload: { eventId: 'event-1', sport: 'football', marketId: 'm-1', selectionId: 's-1' } });
      expect(response.statusCode).toBe(200);
      const result = response.json<{ selected: { odds: number }; alternatives: Array<{
        marketId: string; freshness: string }>; source: string }>();
      expect(result.selected.odds).toBe(1.7);
      expect(result.source).toContain('SportyBet');
      expect(result.alternatives.map((item) => item.marketId)).toEqual(['m-1', 'm-2']);
      expect(result.alternatives[1]?.freshness).toBe('stale');
      const missing = await app.inject({ method: 'POST', url: '/api/miniapp/compare-markets', headers,
        payload: { eventId: 'event-1', sport: 'football', marketId: 'missing', selectionId: 'x' } });
      expect(missing.json<{ warnings: string[] }>().warnings.join(' ')).toContain('not found active');
    } finally { await app.close(); }
  });

  it('verifies signed slip selections, odds changes and missing data without AI or betting', async () => {
    const app = await setup();
    try {
      const initData = telegramAuth();
      const headers = { 'x-telegram-init-data': initData };
      const analysisToken = slipToken(initData, [slip]);
      const response = await app.inject({ method: 'POST', url: '/api/miniapp/reliability', headers,
        payload: { selections: [slip], analysisToken } });
      expect(response.statusCode).toBe(200);
      const result = response.json<{ verified: number; total: number; selections: Array<{
        available: boolean; previousOdds: number; currentOdds: number; warnings: string[] }>;
        missingData: string[] }>();
      expect(result).toMatchObject({ verified: 0, total: 1 });
      expect(result.selections[0]).toMatchObject({ available: true, previousOdds: 1.65,
        currentOdds: 1.7 });
      expect(result.selections[0]?.warnings.join(' ')).toContain('Odds changed');
      expect(result.missingData.join(' ')).toContain('lineups');
      const tampered = await app.inject({ method: 'POST', url: '/api/miniapp/reliability', headers,
        payload: { selections: [{ ...slip, selectionId: 'fabricated' }], analysisToken } });
      expect(tampered.statusCode).toBe(401);
      const wrongSession = await app.inject({ method: 'POST', url: '/api/miniapp/reliability',
        headers: { 'x-telegram-init-data': telegramAuth('other-session') },
        payload: { selections: [slip], analysisToken } });
      expect(wrongSession.statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
