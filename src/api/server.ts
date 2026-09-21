import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { Logger } from 'pino';
import type { FastifyInstance } from 'fastify';
import { registerAdminRoutes } from '../admin/routes.js';
import type { AdminDependencies } from '../admin/routes.js';
import type { Telegraf } from 'telegraf';
import { ZodError } from 'zod';
import { landingPage, landingStyles } from '../web/landing-v4.js';
import { registerMiniAppRoutes, type MiniAppDependencies } from './mini-app-routes.js';
import { registerBookingCodeAnalysisRoute } from './booking-code-analysis.js';
import { registerCodeWorkspaceRoutes } from './code-workspace-routes.js';
import { registerCodeMarketOptions } from './code-market-options.js';
import { registerDeskRoutes } from './desk-routes.js';
import { registerIntelligenceRoutes } from './intelligence-routes.js';
import { registerSlipEditorRoutes } from './slip-editor-routes.js';
import { registerWatchRoutes } from './watch-routes.js';
import { registerNewsRoutes } from './news-routes.js';
import type { WebResearchProvider } from '../you/provider.js';
import type { WatchService } from '../watch/watch-service.js';

interface TelegramWebhook {
  bot: Pick<Telegraf, 'handleUpdate'>;
  secret: string;
}

export async function createServer(
  logger: Logger,
  dependencies: AdminDependencies,
  telegram?: TelegramWebhook,
  miniApp?: MiniAppDependencies,
  watch?: { service: WatchService; cronSecret?: string },
  news?: { provider: Pick<WebResearchProvider, 'search'>; enabled: boolean },
) {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 8_500_000, requestTimeout: 60_000 });
  await app.register(sensible);
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('x-request-id', request.id);
    return payload;
  });
  app.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').send(landingPage));
  app.get('/styles.css', (_request, reply) =>
    reply.header('cache-control', 'public, max-age=3600, stale-while-revalidate=86400')
      .type('text/css; charset=utf-8').send(landingStyles));
  app.get('/health', async () => {
    const [database, redis, sportsProvider, sportyBetProvider] = await Promise.all([
      dependencies.database.health(), dependencies.cache.health(),
      dependencies.sports.health(), dependencies.sportyBet.health(),
    ]);
    return { service: 'AUREX', version: '3.0.0', status: 'ok',
      dependencies: { database, redis, sportsProvider, sportyBetProvider } };
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
  if (miniApp) {
    // Register the signed Telegram preHandler before every /api/miniapp/* feature.
    registerMiniAppRoutes(app as unknown as FastifyInstance, miniApp);
    registerBookingCodeAnalysisRoute(app as unknown as FastifyInstance, miniApp);
    registerCodeWorkspaceRoutes(app as unknown as FastifyInstance, miniApp);
    registerCodeMarketOptions(app as unknown as FastifyInstance, miniApp.sportyBet);
    registerDeskRoutes(app as unknown as FastifyInstance, miniApp.sportyBet);
    registerIntelligenceRoutes(app as unknown as FastifyInstance, miniApp);
    registerSlipEditorRoutes(app as unknown as FastifyInstance, miniApp);
    if (news) registerNewsRoutes(app as unknown as FastifyInstance, news.provider, news.enabled);
    if (watch) registerWatchRoutes(app as unknown as FastifyInstance, watch.service, watch.cronSecret);
  }
  app.setErrorHandler((error, request, reply) => {
    dependencies.metrics.increment('errors');
    if (error instanceof ZodError) return reply.status(400).send({ error: 'Invalid request',
      message: error.issues[0]?.message ?? 'Check the supplied values.', requestId: request.id });
    const normalized = error instanceof Error ? error : new Error('Unknown request failure');
    const suppliedStatus = typeof error === 'object' && error !== null &&
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
    const statusCode = suppliedStatus && suppliedStatus < 500 ? suppliedStatus : 500;
    if (statusCode >= 500) logger.error({ err: normalized, requestId: request.id }, 'Request failed');
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Service temporarily unavailable' : normalized.name,
      message: statusCode >= 500 ? 'The request could not be completed. Nothing was booked.' : normalized.message,
      requestId: request.id,
    });
  });
  return app;
}
