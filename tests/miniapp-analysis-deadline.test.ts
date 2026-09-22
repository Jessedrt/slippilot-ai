import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const botToken = '1234567890:test-telegram-token';

function telegramInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'deadline-test',
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return params.toString();
}

describe('Mini App analysis deadline', () => {
  it('returns a structured response before a slow statistics provider can cause a host timeout', async () => {
    const fixture = {
      providerEventId: 'slow-basketball-1',
      homeTeam: 'Home',
      awayTeam: 'Away',
      startsAt: new Date(Date.now() + 3_600_000),
      status: 'scheduled' as const,
      league: 'Test League',
    };
    const sportyBet: SportyBetProvider = {
      name: 'SportyBet',
      listEvents: () => Promise.resolve([fixture]),
      findEvents: () => Promise.resolve([fixture]),
      getEvent: () => Promise.resolve(fixture),
      getMarkets: () =>
        Promise.resolve([
          {
            eventId: fixture.providerEventId,
            providerMarketId: 'total',
            providerSelectionId: 'under',
            sport: 'basketball',
            category: 'Total',
            marketName: 'Over/Under (incl. overtime)',
            selectionName: 'Under 165.5',
            odds: 1.8,
            status: 'active',
            lastUpdated: new Date(),
          },
        ]),
      resolveBookingCode: () => Promise.resolve([]),
      createBookingCode: () => Promise.resolve('MUST_NOT_BE_CREATED'),
      health: () => Promise.resolve({ ok: true, detail: 'test' }),
    };
    const app = Fastify();
    await app.register(sensible);
    registerMiniAppRoutes(app, {
      sportyBet,
      telegramBotToken: botToken,
      analysisDeadlineMs: 30,
      slipAnalyzer: { analyze: () => Promise.reject(new Error('must not run')) },
      screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) },
      basketballStatistics: {
        name: 'slow-deterministic-mock',
        getSnapshot: () => new Promise<never>(() => undefined),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/miniapp/build',
        headers: { 'x-telegram-init-data': telegramInitData() },
        payload: { sport: 'basketball', targetOdds: 50, riskMode: 'conservative' },
      });
      expect(response.statusCode).toBe(503);
      const body = response.json<{ message: string }>();
      expect(body).toMatchObject({
        status: 'analysis_deadline_exceeded',
        reason: 'analysis_deadline_exceeded',
        retryable: true,
      });
      expect(body.message).toContain('No incomplete slip or booking code was created');
    } finally {
      await app.close();
    }
  });
});
