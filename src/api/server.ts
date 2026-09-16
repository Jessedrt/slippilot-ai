import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import { registerAdminRoutes } from '../admin/routes.js';
import type { AdminDependencies } from '../admin/routes.js';
import type { Telegraf } from 'telegraf';
import { landingPage, landingStyles } from '../web/landing-page.js';
import { registerMiniAppRoutes, type MiniAppDependencies } from './mini-app-routes.js';

interface TelegramWebhook {
  bot: Pick<Telegraf, 'handleUpdate'>;
  secret: string;
}

export async function createServer(
  logger: Logger,
  dependencies: AdminDependencies,
  telegram?: TelegramWebhook,
  miniApp?: MiniAppDependencies,
) {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 8_500_000, requestTimeout: 60_000 });
  await app.register(sensible);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').send(landingPage));
  app.get('/styles.css', (_request, reply) =>
    reply
      .header('cache-control', 'public, max-age=3600, stale-while-revalidate=86400')
      .type('text/css; charset=utf-8')
      .send(landingStyles),
  );
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
  app.post('/api/telegram', async (request, reply) => {
    if (!telegram) return reply.notFound();
    if (request.headers['x-telegram-bot-api-secret-token'] !== telegram.secret) {
      return reply.unauthorized('Invalid Telegram webhook secret');
    }
    await telegram.bot.handleUpdate(request.body as Parameters<Telegraf['handleUpdate']>[0]);
    return { ok: true };
  });
  registerAdminRoutes(app as unknown as FastifyInstance, dependencies);
  if (miniApp) registerMiniAppRoutes(app as unknown as FastifyInstance, miniApp);
  return app;
}
