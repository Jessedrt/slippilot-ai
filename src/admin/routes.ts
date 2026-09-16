import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { SportsProvider } from '../sports/provider.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CacheService } from '../services/cache.js';
import type { DatabaseService } from '../database/client.js';
import type { MetricsService } from './metrics.js';

export interface AdminDependencies {
  config: AppConfig;
  metrics: MetricsService;
  cache: CacheService;
  database: DatabaseService;
  sports: SportsProvider;
  sportyBet: SportyBetProvider;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDependencies): void {
  app.get('/admin/metrics', async (request, reply) => {
    if (
      !deps.config.ADMIN_SECRET ||
      request.headers['x-admin-secret'] !== deps.config.ADMIN_SECRET
    ) {
      return reply.unauthorized('Invalid admin credentials');
    }
    const [database, redis, sports, sportyBet] = await Promise.all([
      deps.database.health(),
      deps.cache.health(),
      deps.sports.health(),
      deps.sportyBet.health(),
    ]);
    return {
      service: 'AUREX',
      metrics: deps.metrics.snapshot(),
      health: { database, redis, sportsProvider: sports, sportyBetProvider: sportyBet },
      subscriptions: { free: 0, pro: 0 },
    };
  });
}
