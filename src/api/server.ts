import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import { registerAdminRoutes } from '../admin/routes.js';
import type { AdminDependencies } from '../admin/routes.js';

export async function createServer(logger: Logger, dependencies: AdminDependencies) {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 1_000_000, requestTimeout: 10_000 });
  await app.register(sensible);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.get('/', () => ({ name: 'SlipPilot AI', status: 'ok', version: '1.0.0' }));
  app.get('/health', async () => {
    const [database, redis, sportsProvider, sportyBetProvider] = await Promise.all([
      dependencies.database.health(),
      dependencies.cache.health(),
      dependencies.sports.health(),
      dependencies.sportyBet.health(),
    ]);
    return {
      service: 'SlipPilot AI',
      status: 'ok',
      dependencies: { database, redis, sportsProvider, sportyBetProvider },
    };
  });
  registerAdminRoutes(app as unknown as FastifyInstance, dependencies);
  return app;
}
