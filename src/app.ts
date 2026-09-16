import { MetricsService } from './admin/metrics.js';
import { createServer } from './api/server.js';
import { DisabledSlipAnalyzer, GeminiSlipAnalyzer } from './ai/slip-analyzer.js';
import { DisabledScreenshotAnalyzer, GeminiScreenshotAnalyzer } from './ai/screenshot-analyzer.js';
import { createBot } from './bot/create-bot.js';
import { BOT_COMMANDS } from './bot/menu.js';
import { loadConfig } from './config/env.js';
import { PrismaConversationStore, PrismaDatabase } from './database/client.js';
import { PrismaResearchSnapshotStore } from './research/store.js';
import { SportsResearchService } from './research/sports-research.js';
import { RedisCache } from './services/cache.js';
import { DisabledSportsProvider } from './sports/provider.js';
import { BrowserSportyBetProvider, UnsupportedSportyBetProvider } from './sportybet/provider.js';
import { createLogger } from './utils/logger.js';
import { YouClient } from './you/client.js';
import { DisabledWebResearchProvider, YouProvider } from './you/provider.js';

export function createApplication() {
  const config = loadConfig();
  const logger = createLogger(config);
  const cache = new RedisCache(config.REDIS_URL);
  const webResearch =
    config.YOU_API_ENABLED && config.YDC_API_KEY
      ? new YouProvider(
          new YouClient({
            apiKey: config.YDC_API_KEY,
            timeoutMs: config.YOU_TIMEOUT_MS,
            maxResults: config.YOU_MAX_RESULTS,
            cacheTtlMs: config.YOU_CACHE_TTL_MS,
            cache,
            logger,
          }),
          config.YOU_SEARCH_ENABLED,
          config.YOU_RESEARCH_ENABLED,
        )
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
  const aiKey = config.GEMINI_API_KEY ?? config.AI_API_KEY;
  const slipAnalyzer =
    config.AI_PROVIDER === 'gemini' && aiKey
      ? new GeminiSlipAnalyzer({
          apiKey: aiKey,
          ...(config.AI_MODEL ? { model: config.AI_MODEL } : {}),
        })
      : new DisabledSlipAnalyzer();
  const screenshotAnalyzer =
    config.AI_PROVIDER === 'gemini' && aiKey
      ? new GeminiScreenshotAnalyzer({
          apiKey: aiKey,
          sportyBet,
          ...(config.AI_MODEL ? { model: config.AI_MODEL } : {}),
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
  const appPromise = createServer(
    logger,
    { config, metrics, cache, database, sports, sportyBet },
    bot && config.TELEGRAM_WEBHOOK_SECRET
      ? { bot, secret: config.TELEGRAM_WEBHOOK_SECRET }
      : undefined,
  );
  const webhookRegistrationPromise =
    bot &&
    config.TELEGRAM_WEBHOOK_SECRET &&
    process.env.VERCEL_ENV === 'production' &&
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? Promise.all([
          bot.telegram.setWebhook(
            `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/telegram`,
            { secret_token: config.TELEGRAM_WEBHOOK_SECRET },
          ),
          bot.telegram.setMyCommands([...BOT_COMMANDS]),
          bot.telegram.setChatMenuButton({ menuButton: { type: 'commands' } }),
        ]).then(([webhook]) => webhook)
      : Promise.resolve(false);

  return { appPromise, bot, cache, config, database, logger, webhookRegistrationPromise };
}
