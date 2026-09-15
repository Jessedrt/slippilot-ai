import { afterEach, describe, expect, it } from 'vitest';
import { MetricsService } from '../../src/admin/metrics.js';
import { createServer } from '../../src/api/server.js';
import { loadConfig } from '../../src/config/env.js';
import type { CacheService } from '../../src/services/cache.js';
import { DisabledSportsProvider } from '../../src/sports/provider.js';
import { UnsupportedSportyBetProvider } from '../../src/sportybet/provider.js';
import { createLogger } from '../../src/utils/logger.js';
import type { DatabaseService } from '../../src/database/client.js';

const cache: CacheService = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  health: () => Promise.resolve({ ok: false, detail: 'Redis unavailable' }),
  close: () => Promise.resolve(),
};
const database: DatabaseService = {
  health: () => Promise.resolve({ ok: false, detail: 'PostgreSQL unavailable' }),
  close: () => Promise.resolve(),
};

describe('API failure handling', () => {
  const apps: Array<Awaited<ReturnType<typeof createServer>>> = [];
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('boots and reports optional provider failures without crashing', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      ADMIN_SECRET: 'test-admin-secret',
    });
    const app = await createServer(createLogger(config), {
      config,
      metrics: new MetricsService(),
      cache,
      database,
      sports: new DisabledSportsProvider(),
      sportyBet: new UnsupportedSportyBetProvider(),
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: 'SlipPilot AI',
      status: 'ok',
      dependencies: { redis: { ok: false }, sportyBetProvider: { ok: false } },
    });
  });
});
