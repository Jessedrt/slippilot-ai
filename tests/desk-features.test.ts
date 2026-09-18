import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import { registerDeskRoutes } from '../src/api/desk-routes.js';
import { registerSlipEditorRoutes } from '../src/api/slip-editor-routes.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const botToken = '1234567890:aurex-test-token';
function initData(): string {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'desk-test', user: JSON.stringify({ id: 42 }) });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('AUREX desk routes', () => {
  it('requires Telegram auth, shows only real fixtures, refreshes watchlist and signs reanalyzed edits', async () => {
    const event = { providerEventId: 'ev-1', league: 'Test League', homeTeam: 'Alpha',
      awayTeam: 'Beta', startsAt: new Date('2026-09-18T18:00:00Z'), status: 'scheduled' as const };
    const tomorrow = { ...event, providerEventId: 'ev-2', startsAt: new Date('2026-09-19T12:00:00Z') };
    const markets: NormalizedMarket[] = [
      { providerMarketId: 'm-1', providerSelectionId: 's-1', eventId: 'ev-1', sport: 'football',
        category: 'total', marketName: 'Goals', selectionName: 'Over 1.5', odds: 1.35,
        status: 'active', lastUpdated: new Date() },
      { providerMarketId: 'm-2', providerSelectionId: 's-2', eventId: 'ev-1', sport: 'football',
        category: 'winner', marketName: 'Match winner', selectionName: 'Alpha', odds: 1.65,
        status: 'active', lastUpdated: new Date() },
    ];
    const provider: SportyBetProvider = { name: 'SportyBet',
      listEvents: () => Promise.resolve([tomorrow, event]),
      findEvents: () => Promise.resolve([event]),
      getEvent: (id) => Promise.resolve(id === 'ev-1' ? event : null),
      getMarkets: () => Promise.resolve(markets),
      resolveBookingCode: () => Promise.resolve([]),
      createBookingCode: () => Promise.resolve('AUREX123'),
      health: () => Promise.resolve({ ok: true, detail: 'test' }),
    };
    let aiCalls = 0;
    const dependencies = { sportyBet: provider, telegramBotToken: botToken,
      slipAnalyzer: { analyze: (selections: NormalizedMarket[]) => {
        aiCalls += 1;
        return Promise.resolve({ model: 'test', analyzedAt: new Date().toISOString(),
          summary: 'All current markets were reviewed.',
          selections: selections.map((_selection, index) => ({ index: index + 1, confidence: 80,
            risk: 'medium' as const, verdict: 'keep' as const, reason: 'Live market checked.' })) });
      } },
      screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) },
    };
    const app = Fastify();
    await app.register(sensible);
    registerMiniAppRoutes(app, dependencies);
    registerDeskRoutes(app, provider);
    registerSlipEditorRoutes(app, dependencies);
    const unauthorized = await app.inject({ method: 'POST', url: '/api/miniapp/fixtures',
      payload: { sport: 'football' } });
    expect(unauthorized.statusCode).toBe(401);
    const headers = { 'x-telegram-init-data': initData() };
    const fixtures = await app.inject({ method: 'POST', url: '/api/miniapp/fixtures',
      headers, payload: { sport: 'football' } });
    expect(fixtures.statusCode).toBe(200);
    expect(fixtures.json().fixtures.map((item: { id: string }) => item.id)).toEqual(['ev-1']);
    const watched = await app.inject({ method: 'POST', url: '/api/miniapp/watchlist-refresh',
      headers, payload: { ids: ['ev-1', 'not-found'] } });
    expect(watched.json().results).toMatchObject([{ available: true }, { available: false }]);

    const build = await app.inject({ method: 'POST', url: '/api/miniapp/build',
      headers, payload: { sport: 'football', gameCount: 1, riskMode: 'balanced' } });
    expect(build.statusCode).toBe(200);
    const original = build.json<{ selections: Array<{ selectionId: string; marketId: string }>;
      analysisToken: string }>();
    expect(aiCalls).toBe(1);
    const tampered = await app.inject({ method: 'POST', url: '/api/miniapp/edit-slip',
      headers, payload: { action: 'replace', index: 0, selections: [
        { ...original.selections[0], selectionId: 'fabricated' }],
        analysisToken: original.analysisToken } });
    expect(tampered.statusCode).not.toBe(200);
    const replacement = await app.inject({ method: 'POST', url: '/api/miniapp/edit-slip', headers,
      payload: { action: 'replace', index: 0,
        selections: original.selections, analysisToken: original.analysisToken } });
    expect(replacement.statusCode).toBe(200);
    const changed = replacement.json<{ selections: Array<{ marketId: string }>; analysisToken: string }>();
    expect(changed.selections[0]?.marketId).not.toBe(original.selections[0]?.marketId);
    expect(aiCalls).toBe(2);
    const reanalysis = await app.inject({ method: 'POST', url: '/api/miniapp/edit-slip', headers,
      payload: { action: 'reanalyze', selections: changed.selections, analysisToken: changed.analysisToken } });
    expect(reanalysis.statusCode).toBe(200);
    expect(aiCalls).toBe(3);
    const confirmed = reanalysis.json<{ selections: unknown[]; analysisToken: string }>();
    const code = await app.inject({ method: 'POST', url: '/api/miniapp/code', headers,
      payload: { selections: confirmed.selections, analysisToken: confirmed.analysisToken } });
    expect(code.statusCode).toBe(200);
    expect(code.json().code).toBe('AUREX123');
    expect(aiCalls).toBe(3);
    await app.close();
  });
});
