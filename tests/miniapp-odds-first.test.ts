import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const botToken = '1234567890:test-telegram-token';
function telegramInitData(): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'odds-first-test',
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
describe('Mini App odds-first build', () => {
  it('explains that basketball totals are unavailable when no statistics provider is configured', async () => {
    const fixture = {
      providerEventId: 'basketball-1',
      homeTeam: 'Home',
      awayTeam: 'Away',
      startsAt: new Date(Date.now() + 3_600_000),
      status: 'scheduled' as const,
      league: 'Test League',
    };
    const sportyBet = {
      name: 'SportyBet',
      listEvents: () => Promise.resolve([fixture]),
      getMarkets: () =>
        Promise.resolve([
          {
            eventId: fixture.providerEventId,
            providerMarketId: 'total',
            providerSelectionId: 'under',
            sport: 'basketball' as const,
            category: 'Total',
            marketName: 'Over/Under (incl. overtime)',
            selectionName: 'Under 165.5',
            line: 165.5,
            odds: 1.9,
            status: 'active' as const,
            lastUpdated: new Date(),
          },
        ]),
      findEvents: () => Promise.resolve([]),
      getEvent: () => Promise.resolve(null),
      resolveBookingCode: () => Promise.resolve([]),
      createBookingCode: () => Promise.resolve('TEST123'),
      health: () => Promise.resolve({ ok: true, detail: 'test' }),
    } as SportyBetProvider;
    const app = Fastify();
    await app.register(sensible);
    registerMiniAppRoutes(app, {
      sportyBet,
      telegramBotToken: botToken,
      slipAnalyzer: { analyze: () => Promise.reject(new Error('must not run')) },
      screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/miniapp/build',
        headers: { 'x-telegram-init-data': telegramInitData() },
        payload: { sport: 'basketball', gameCount: 1 },
      });
      expect(response.statusCode).toBe(424);
      const body = response.json<{ status: string; reason: string; message: string }>();
      expect(body).toMatchObject({
        status: 'basketball_totals_unavailable',
        reason: 'provider_not_configured',
      });
      expect(body.message).toContain('No slip or booking code was created');
    } finally {
      await app.close();
    }
  });

  it('derives count from odds and returns only today when eligible games exist, with real date', async () => {
    const today = Array.from({ length: 3 }, (_, index) => ({
      providerEventId: `today-${index + 1}`,
      homeTeam: `Home ${index + 1}`,
      awayTeam: `Away ${index + 1}`,
      startsAt: new Date(Date.now() + (index + 1) * 3_600_000),
      status: 'scheduled' as const,
      league: 'Test League',
    }));
    const tomorrow = {
      ...today[0]!,
      providerEventId: 'tomorrow-1',
      startsAt: new Date(Date.now() + 26 * 3_600_000),
    };
    const getMarkets = vi.fn((eventId: string): Promise<NormalizedMarket[]> =>
      Promise.resolve([
        {
          eventId,
          providerMarketId: `market-${eventId}`,
          providerSelectionId: `selection-${eventId}`,
          sport: 'football',
          category: 'totals',
          marketName: 'Over/Under Goals',
          selectionName: 'Over 1.5',
          odds: 1.6,
          status: 'active',
          lastUpdated: new Date(),
        },
      ]),
    );
    const sportyBet = {
      name: 'SportyBet',
      listEvents: () => Promise.resolve([...today, tomorrow]),
      getMarkets,
      findEvents: () => Promise.resolve([]),
      getEvent: () => Promise.resolve(null),
      resolveBookingCode: () => Promise.resolve([]),
      createBookingCode: () => Promise.resolve('TEST123'),
      health: () => Promise.resolve({ ok: true, detail: 'test' }),
    } as SportyBetProvider;
    const app = Fastify();
    await app.register(sensible);
    registerMiniAppRoutes(app, {
      sportyBet,
      telegramBotToken: botToken,
      slipAnalyzer: {
        analyze: (selections) =>
          Promise.resolve({
            model: 'test-ai',
            analyzedAt: new Date().toISOString(),
            summary: 'Reviewed active markets.',
            selections: selections.map((_item, index) => ({
              index: index + 1,
              confidence: 68,
              risk: 'medium' as const,
              verdict: 'keep' as const,
              reason: 'Test selection.',
            })),
          }),
      },
      screenshotAnalyzer: { analyze: () => Promise.resolve({ items: [], bookingCodes: [] }) },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/miniapp/build',
        headers: { 'x-telegram-init-data': telegramInitData() },
        payload: {
          sport: 'football',
          targetOdds: 5,
          riskMode: 'balanced',
          gameCount: 99,
          todayOnly: false,
        },
      });
      expect(response.statusCode).toBe(200);
      const result = response.json<{
        targetOdds: number;
        requestedGames: number;
        availableGames: number;
        shortfall: number;
        schedule: string;
        scheduleDate: string;
        dayOffset: number;
        targetReached: boolean;
        targetStatus: string;
        selections: Array<{ eventId: string }>;
      }>();
      // ceil(log(5) / log(1.55)) = 4; supplied gameCount=99 must be ignored.
      expect(result).toMatchObject({
        targetOdds: 5,
        requestedGames: 4,
        availableGames: 3,
        shortfall: 1,
        scheduleDate: '2026-09-16',
        schedule: 'today (2026-09-16, Africa/Lagos)',
        dayOffset: 0,
        targetReached: false,
        targetStatus: 'not_reached',
      });
      expect(result.selections).toHaveLength(3);
      expect(result.selections.every((selection) => selection.eventId.startsWith('today-'))).toBe(
        true,
      );
      expect(getMarkets).toHaveBeenCalledTimes(3);
    } finally {
      await app.close();
    }
  });
});
