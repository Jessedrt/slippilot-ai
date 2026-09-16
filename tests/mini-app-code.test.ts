import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const botToken = '1234567890:test-telegram-token';

function telegramInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'test-query',
    user: JSON.stringify({ id: 42, first_name: 'Test' }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('Mini App analyzed booking flow', () => {
  it('uses the signed build analysis when creating a code instead of calling AI twice', async () => {
    const event = {
      providerEventId: 'event-1',
      homeTeam: 'Aurex City',
      awayTeam: 'Neon United',
      startsAt: new Date(Date.now() + 3_600_000),
      status: 'scheduled' as const,
    };
    const market: NormalizedMarket = {
      providerMarketId: 'market-1',
      providerSelectionId: 'selection-1',
      eventId: event.providerEventId,
      sport: 'football',
      category: 'totals',
      marketName: 'Over/Under Goals',
      selectionName: 'Over 1.5',
      odds: 1.35,
      status: 'active',
      lastUpdated: new Date(),
    };
    let analysisCalls = 0;
    const app = Fastify();
    await app.register(sensible);
    registerMiniAppRoutes(app, {
      telegramBotToken: botToken,
      sportyBet: {
        name: 'SportyBet',
        listEvents: () => Promise.resolve([event]),
        findEvents: () => Promise.resolve([event]),
        getEvent: () => Promise.resolve(event),
        getMarkets: () => Promise.resolve([market]),
        resolveBookingCode: () => Promise.resolve([]),
        createBookingCode: () => Promise.resolve('AUREX123'),
        health: () => Promise.resolve({ ok: true, detail: 'test' }),
      },
      slipAnalyzer: {
        analyze: (selections) => {
          analysisCalls += 1;
          return Promise.resolve({
            model: 'test-ai',
            analyzedAt: new Date().toISOString(),
            summary: 'Reviewed once.',
            selections: selections.map((_selection, index) => ({
              index: index + 1,
              confidence: 82,
              risk: 'lower' as const,
              verdict: 'keep' as const,
              reason: 'Active lower-variance market.',
            })),
          });
        },
      },
      screenshotAnalyzer: {
        analyze: () => Promise.resolve({ items: [], bookingCodes: [] }),
      },
    });

    const initData = telegramInitData();
    const build = await app.inject({
      method: 'POST',
      url: '/api/miniapp/build',
      headers: { 'x-telegram-init-data': initData },
      payload: { sport: 'football', gameCount: 1, riskMode: 'balanced' },
    });
    expect(build.statusCode).toBe(200);
    const built = build.json<{
      analysisToken: string;
      selections: Array<Record<string, unknown>>;
    }>();
    expect(built.analysisToken).toEqual(expect.any(String));
    expect(analysisCalls).toBe(1);

    const code = await app.inject({
      method: 'POST',
      url: '/api/miniapp/code',
      headers: { 'x-telegram-init-data': initData },
      payload: { selections: built.selections, analysisToken: built.analysisToken },
    });
    expect(code.statusCode).toBe(200);
    expect(code.json()).toMatchObject({ status: 'ready', code: 'AUREX123', selections: 1 });
    expect(analysisCalls).toBe(1);

    const tampered = await app.inject({
      method: 'POST',
      url: '/api/miniapp/code',
      headers: { 'x-telegram-init-data': initData },
      payload: {
        selections: [{ ...built.selections[0], selectionId: 'not-approved' }],
        analysisToken: built.analysisToken,
      },
    });
    expect(tampered.statusCode).toBe(401);
    await app.close();
  });
});
