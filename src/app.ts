import { MetricsService } from './admin/metrics.js';
import { createServer } from './api/server.js';
import { DisabledSlipAnalyzer } from './ai/slip-analyzer.js';
import { YouSlipAnalyzer } from './ai/you-slip-analyzer.js';
import { DisabledScreenshotAnalyzer, GeminiScreenshotAnalyzer } from './ai/screenshot-analyzer.js';
import { createBot } from './bot/create-bot.js';
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
          // Standard structured Research can take longer than an ordinary web search.
          timeoutMs: Math.max(config.YOU_TIMEOUT_MS, 45_000),
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
  const aiKeys = [...new Set([config.GEMINI_API_KEY, config.AI_API_KEY].filter(Boolean))] as string[];
  const aiKey = aiKeys[0];
  // YDC is the only provider for text/slip analysis. Never silently fall back to Gemini text.
  const slipAnalyzer =
    youClient && config.YOU_RESEARCH_ENABLED
      ? new YouSlipAnalyzer(youClient)
      : new DisabledSlipAnalyzer();
  // Gemini is only used for image/screenshot understanding, not textual slip decisions.
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
  // A preview never dispatches Telegram messages. Production requires CRON_SECRET,
  // configured provider, bot token and a real scheduled request before alerts work.
  const alertReady = Boolean(config.CRON_SECRET && config.TELEGRAM_BOT_TOKEN &&
    config.SPORTYBET_PROVIDER_ENABLED && process.env.VERCEL_ENV === 'production');
  const watch = new WatchService(new PrismaWatchStore(database.client), sportyBet,
    alertReady && config.TELEGRAM_BOT_TOKEN ? new TelegramWatchSender(config.TELEGRAM_BOT_TOKEN) : null,
    alertReady);
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
      ...(config.TELEGRAM_BOT_TOKEN ? { telegramBotToken: config.TELEGRAM_BOT_TOKEN } : {}),
    },
    { service: watch, ...(config.CRON_SECRET ? { cronSecret: config.CRON_SECRET } : {}) },
  );
  // Telegram setup is persistent and must not run on every serverless cold start.
  const webhookRegistrationPromise = Promise.resolve(false);

  return { appPromise, bot, cache, config, database, logger, webhookRegistrationPromise };
}
