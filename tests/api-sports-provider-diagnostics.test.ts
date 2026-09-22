import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApiSportsClient, ApiSportsError } from '../src/api-sports/client.js';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import {
  diagnoseApiSports,
  registerApiSportsDiagnosticRoutes,
} from '../src/api/provider-diagnostics.js';
import { loadConfig } from '../src/config/env.js';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import type { ScreenshotAnalyzer } from '../src/ai/screenshot-analyzer.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const key = 'safe-fixture-key-not-real';
const statusBody = {
  get: 'status',
  parameters: [],
  errors: [],
  results: 1,
  paging: { current: 1, total: 1 },
  response: {
    account: { email: 'must-not-leak@example.com', firstname: 'Private' },
    subscription: { plan: 'FREE', active: 1 },
    requests: { current: 0, limit_day: 100 },
  },
};
const config = () =>
  loadConfig({
    API_SPORTS_ENABLED: 'true',
    API_SPORTS_KEY: key,
    API_SPORTS_COMMERCIAL_USE_APPROVED: 'true',
    API_SPORTS_DATA_RIGHTS_CONFIRMED: 'true',
    API_SPORTS_FOOTBALL_ENABLED: 'true',
    API_SPORTS_BASKETBALL_TOTALS_ENABLED: 'true',
  });

describe('API-Sports provider diagnostics', () => {
  it('accepts the documented empty parameters array in /status and never sends the key in its URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(statusBody), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new ApiSportsClient({ apiKey: key, fetch: fetchMock, maxRetries: 0 });
    const result = await client.verifyEntitlement('football');
    expect(result.data.requests).toMatchObject({ current: 0, limit_day: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0]![0];
    if (typeof requestUrl !== 'string') throw new Error('Expected a string request URL');
    expect(requestUrl).toBe('https://v3.football.api-sports.io/status?');
    expect(requestUrl).not.toContain(key);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('x-apisports-key')).toBe(key);
  });

  it('returns only sanitized status and distinguishes connected from enabled analysis', async () => {
    const client = { verifyEntitlement: vi.fn().mockResolvedValue({ data: statusBody.response }) };
    const football = await diagnoseApiSports(config(), 'football', client);
    expect(football).toMatchObject({
      product: 'football',
      state: 'connected',
      analysisEnabled: true,
      requestsToday: 0,
      dailyLimit: 100,
    });
    expect(JSON.stringify(football)).not.toContain('must-not-leak');
    expect(JSON.stringify(football)).not.toContain(key);
    const rightsUnconfirmed = loadConfig({
      API_SPORTS_ENABLED: 'true',
      API_SPORTS_KEY: key,
      API_SPORTS_COMMERCIAL_USE_APPROVED: 'true',
      API_SPORTS_FOOTBALL_ENABLED: 'true',
    });
    expect(await diagnoseApiSports(rightsUnconfirmed, 'football', client)).toMatchObject({
      state: 'connected',
      analysisEnabled: false,
      activationBlock: 'data_rights_unconfirmed',
    });
    const disabledSport = loadConfig({ API_SPORTS_ENABLED: 'true', API_SPORTS_KEY: key });
    expect(await diagnoseApiSports(disabledSport, 'basketball', client)).toMatchObject({
      state: 'connected',
      analysisEnabled: false,
    });
  });

  it('fails closed for missing key, inactive plan, and unavailable or rejected providers', async () => {
    expect(await diagnoseApiSports(loadConfig({}), 'football')).toMatchObject({
      state: 'disabled',
    });
    const inactive = {
      verifyEntitlement: vi.fn().mockResolvedValue({
        data: { ...statusBody.response, subscription: { active: 0 } },
      }),
    };
    expect(await diagnoseApiSports(config(), 'football', inactive)).toMatchObject({
      state: 'inactive_subscription',
    });
    const rejected = {
      verifyEntitlement: vi
        .fn()
        .mockRejectedValue(new ApiSportsError('unauthorized', `Secret ${key} rejected`)),
    };
    const result = await diagnoseApiSports(config(), 'basketball', rejected);
    expect(result).toMatchObject({ state: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(
      await diagnoseApiSports(config(), 'basketball', {
        verifyEntitlement: vi.fn().mockRejectedValue(new Error('network')),
      }),
    ).toMatchObject({ state: 'provider_unavailable' });
  });

  it('does not allow unauthenticated access to the Mini App diagnostics route', async () => {
    const app = Fastify();
    await app.register(sensible);
    await app.register(rateLimit);
    const botToken = '1234567890:test-telegram-token';
    registerMiniAppRoutes(app, {
      sportyBet: {} as SportyBetProvider,
      slipAnalyzer: {} as SlipAnalyzer,
      screenshotAnalyzer: {} as ScreenshotAnalyzer,
      telegramBotToken: botToken,
    });
    registerApiSportsDiagnosticRoutes(app, loadConfig({}));
    try {
      const unauthorized = await app.inject({ method: 'GET', url: '/api/miniapp/provider-status' });
      expect(unauthorized.statusCode).toBe(401);
      const unauthorizedCoverage = await app.inject({
        method: 'POST',
        url: '/api/miniapp/provider-coverage',
        payload: { sport: 'football', maximumFixtures: 1 },
      });
      expect(unauthorizedCoverage.statusCode).toBe(401);
      const params = new URLSearchParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'diagnostics-test',
      });
      const text = [...params.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${value}`)
        .join('\n');
      const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
      params.set('hash', createHmac('sha256', secret).update(text).digest('hex'));
      const authorized = await app.inject({
        method: 'GET',
        url: '/api/miniapp/provider-status',
        headers: { 'x-telegram-init-data': params.toString() },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json()).toMatchObject({
        football: { state: 'disabled', analysisEnabled: false },
        basketball: { state: 'disabled', analysisEnabled: false },
      });
      expect(authorized.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});
