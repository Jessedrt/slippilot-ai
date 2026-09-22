import { MetricsService } from './admin/metrics.js';
import { createServer } from './api/server.js';
import { DisabledSlipAnalyzer } from './ai/slip-analyzer.js';
import { YouSlipAnalyzer } from './ai/you-slip-analyzer.js';
import { DisabledScreenshotAnalyzer, GeminiScreenshotAnalyzer } from './ai/screenshot-analyzer.js';
import { createBot } from './bot/create-bot.js';
import { ensureProductionWebhook } from './bot/ensure-webhook.js';
import { loadConfig } from './config/env.js';
import { PrismaConversationStore, PrismaDatabase } from './database/client.js';
import { PrismaResearchSnapshotStore } from './research/store.js';
import { SportsResearchService } from './research/sports-research.js';
import { RedisCache } from './services/cache.js';
import { DisabledSportsProvider } from './sports/provider.js';
import { BrowserSportyBetProvider, UnsupportedSportyBetProvider } from './sportybet/provider.js';
import { createLogger } from './utils/logger.js';
import { PrismaWatchStore, TelegramWatchSender, WatchService } from './watch/watch-service.js';
import { YouClient } from './you/client.js';
import { DisabledWebResearchProvider, YouProvider } from './you/provider.js';
import { ApiSportsClient } from './api-sports/client.js';
import {
  parseVerifiedFixtureMappings,
  VerifiedFixtureIdentityRegistry,
} from './api-sports/fixture-identity.js';
import {
  ApiSportsBasketballStatisticsProvider,
  ApiSportsFootballStatisticsProvider,
} from './api-sports/statistics-provider.js';
import { ApiSportsOperations } from './api-sports/operations.js';

export function createApplication() {
  const config = loadConfig();
  const logger = createLogger(config);
  const cache = new RedisCache(config.REDIS_URL);
  const youApiKeys = [
    config.YDC_API_KEY,
    config.YDC_API_KEY_2,
    config.YDC_API_KEY_3,
    config.YDC_API_KEY_4,
    config.YDC_API_KEY_5,
    config.YDC_API_KEY_6,
    config.YDC_API_KEY_7,
    config.YDC_API_KEY_8,
    config.YDC_API_KEY_9,
    config.YDC_API_KEY_10,
  ].filter((key): key is string => Boolean(key));
  const youClient =
    config.YOU_API_ENABLED && youApiKeys[0]
      ? new YouClient({
          apiKey: youApiKeys[0],
          apiKeys: youApiKeys.slice(1),
          timeoutMs: config.YOU_TIMEOUT_MS,
          totalTimeoutMs: config.YOU_TOTAL_TIMEOUT_MS,
          maxAttempts: config.YOU_MAX_ATTEMPTS,
          maxResults: config.YOU_MAX_RESULTS,
          cacheTtlMs: config.YOU_CACHE_TTL_MS,
          cache,
          logger,
        })
      : null;
  const webResearch = youClient
    ? new YouProvider(youClient, config.YOU_SEARCH_ENABLED, config.YOU_RESEARCH_ENABLED)
    : new DisabledWebResearchProvider();
  const sports = new DisabledSportsProvider();
  const sportyBet = config.SPORTYBET_PROVIDER_ENABLED
    ? new BrowserSportyBetProvider({
        baseUrl: config.SPORTYBET_API_BASE_URL,
        region: config.SPORTYBET_REGION,
        timeoutMs: config.SPORTYBET_TIMEOUT_MS,
        minIntervalMs: config.SPORTYBET_MIN_INTERVAL_MS,
        maxConcurrency: config.SPORTYBET_MAX_CONCURRENCY,
        maxRetries: config.SPORTYBET_MAX_RETRIES,
        cacheTtlMs: config.SPORTYBET_CACHE_TTL_MS,
      })
    : new UnsupportedSportyBetProvider();
  const apiSportsOperations = new ApiSportsOperations();
  const apiSports =
    config.API_SPORTS_ENABLED && config.API_SPORTS_KEY
      ? new ApiSportsClient({
          apiKey: config.API_SPORTS_KEY,
          timeoutMs: config.API_SPORTS_TIMEOUT_MS,
          maxRetries: config.API_SPORTS_MAX_RETRIES,
          cache,
          onRequest: (event) => {
            apiSportsOperations.recordRequest(event);
            if (event.outcome === 'failure') {
              logger.warn(
                {
                  provider: 'api-sports',
                  product: event.product,
                  endpoint: event.path,
                  errorCode: event.errorCode ?? 'unknown',
                  durationMs: event.durationMs,
                  ...(event.providerDetail ? { providerDetail: event.providerDetail } : {}),
                },
                'API-Sports backend request failed',
              );
            }
          },
        })
      : null;
  const apiSportsIdentities = new VerifiedFixtureIdentityRegistry(
    parseVerifiedFixtureMappings(config.API_SPORTS_VERIFIED_MAPPINGS_JSON),
  );
  const apiSportsAnalysisAuthorized = Boolean(
    config.API_SPORTS_COMMERCIAL_USE_APPROVED && config.API_SPORTS_DATA_RIGHTS_CONFIRMED,
  );
  const footballStatistics =
    apiSports && apiSportsAnalysisAuthorized && config.API_SPORTS_FOOTBALL_ENABLED
      ? new ApiSportsFootballStatisticsProvider(apiSports, apiSportsIdentities, apiSportsOperations)
      : undefined;
  const basketballStatistics =
    apiSports && apiSportsAnalysisAuthorized && config.API_SPORTS_BASKETBALL_TOTALS_ENABLED
      ? new ApiSportsBasketballStatisticsProvider(
          apiSports,
          apiSportsIdentities,
          apiSportsOperations,
        )
      : undefined;
  const aiKeys = [
    ...new Set([config.GEMINI_API_KEY, config.AI_API_KEY].filter(Boolean)),
  ] as string[];
  const aiKey = aiKeys[0];
  const slipAnalyzer =
    youClient && config.YOU_RESEARCH_ENABLED
      ? new YouSlipAnalyzer(youClient)
      : new DisabledSlipAnalyzer();
  const screenshotAnalyzer = aiKey
    ? new GeminiScreenshotAnalyzer({
        apiKey: aiKey,
        sportyBet,
        model: config.VISION_MODEL,
      })
    : new DisabledScreenshotAnalyzer();
  const metrics = new MetricsService();
  const database = new PrismaDatabase();
  const research = new SportsResearchService(
    webResearch,
    config.YOU_MAX_RESULTS,
    new PrismaResearchSnapshotStore(database.client),
  );
  const conversations = new PrismaConversationStore(database.client);
  const bot = createBot({
    config,
    logger,
    conversations,
    sportyBet,
    research,
    slipAnalyzer,
    screenshotAnalyzer,
  });
  const alertReady = Boolean(
    config.CRON_SECRET &&
    config.TELEGRAM_BOT_TOKEN &&
    config.SPORTYBET_PROVIDER_ENABLED &&
    process.env.VERCEL_ENV === 'production',
  );
  const watch = new WatchService(
    new PrismaWatchStore(database.client),
    sportyBet,
    alertReady && config.TELEGRAM_BOT_TOKEN
      ? new TelegramWatchSender(config.TELEGRAM_BOT_TOKEN)
      : null,
    alertReady,
  );
  const appPromise = createServer(
    logger,
    { config, metrics, cache, database, sports, sportyBet },
    bot && config.TELEGRAM_WEBHOOK_SECRET
      ? { bot, secret: config.TELEGRAM_WEBHOOK_SECRET }
      : undefined,
    {
      sportyBet,
      slipAnalyzer,
      screenshotAnalyzer,
      ...(footballStatistics ? { footballStatistics } : {}),
      ...(basketballStatistics ? { basketballStatistics } : {}),
      analysisDeadlineMs: config.ANALYSIS_DEADLINE_MS,
      analysisConcurrency: config.API_SPORTS_ANALYSIS_CONCURRENCY,
      ...(apiSports ? { apiSportsClient: apiSports } : {}),
      apiSportsIdentities,
      apiSportsOperations,
      apiSportsActivation: {
        football: {
          requested: config.API_SPORTS_FOOTBALL_ENABLED,
          active: Boolean(footballStatistics),
          ...(!config.API_SPORTS_ENABLED
            ? { reason: 'client_disabled' as const }
            : !config.API_SPORTS_KEY
              ? { reason: 'missing_key' as const }
              : !config.API_SPORTS_FOOTBALL_ENABLED
                ? { reason: 'sport_disabled' as const }
                : !config.API_SPORTS_COMMERCIAL_USE_APPROVED
                  ? { reason: 'commercial_use_not_declared' as const }
                  : !config.API_SPORTS_DATA_RIGHTS_CONFIRMED
                    ? { reason: 'data_rights_unconfirmed' as const }
                    : {}),
        },
        basketball: {
          requested: config.API_SPORTS_BASKETBALL_TOTALS_ENABLED,
          active: Boolean(basketballStatistics),
          ...(!config.API_SPORTS_ENABLED
            ? { reason: 'client_disabled' as const }
            : !config.API_SPORTS_KEY
              ? { reason: 'missing_key' as const }
              : !config.API_SPORTS_BASKETBALL_TOTALS_ENABLED
                ? { reason: 'sport_disabled' as const }
                : !config.API_SPORTS_COMMERCIAL_USE_APPROVED
                  ? { reason: 'commercial_use_not_declared' as const }
                  : !config.API_SPORTS_DATA_RIGHTS_CONFIRMED
                    ? { reason: 'data_rights_unconfirmed' as const }
                    : {}),
        },
      },
      ...(config.TELEGRAM_BOT_TOKEN ? { telegramBotToken: config.TELEGRAM_BOT_TOKEN } : {}),
    },
    { service: watch, ...(config.CRON_SECRET ? { cronSecret: config.CRON_SECRET } : {}) },
    { provider: webResearch, enabled: Boolean(youClient && config.YOU_SEARCH_ENABLED) },
  );
  const webhookRegistrationPromise =
    process.env.VERCEL_ENV === 'production' && bot && config.TELEGRAM_WEBHOOK_SECRET
      ? ensureProductionWebhook(bot.telegram, config.TELEGRAM_WEBHOOK_SECRET)
          .then((changed) => {
            logger.info({ changed }, 'AUREX Telegram webhook verified');
            return true;
          })
          .catch((error: unknown) => {
            logger.warn(
              { message: error instanceof Error ? error.message : 'Unknown setup failure' },
              'AUREX Telegram webhook setup failed',
            );
            return false;
          })
      : Promise.resolve(false);

  return { appPromise, bot, cache, config, database, logger, webhookRegistrationPromise };
}
