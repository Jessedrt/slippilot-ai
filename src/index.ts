import { MetricsService } from './admin/metrics.js';
import { createServer } from './api/server.js';
import { createBot } from './bot/create-bot.js';
import { loadConfig } from './config/env.js';
import { RedisCache } from './services/cache.js';
import { PrismaConversationStore, PrismaDatabase } from './database/client.js';
import { DisabledSportsProvider } from './sports/provider.js';
import { BrowserSportyBetProvider, UnsupportedSportyBetProvider } from './sportybet/provider.js';
import { createLogger } from './utils/logger.js';

const config = loadConfig();
const logger = createLogger(config);
const cache = new RedisCache(config.REDIS_URL);
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
const metrics = new MetricsService();
const database = new PrismaDatabase();
const conversations = new PrismaConversationStore(database.client);

const app = await createServer(logger, { config, metrics, cache, database, sports, sportyBet });
const bot = createBot({ config, logger, conversations, sportyBet });

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Stopping SlipPilot AI');
  bot?.stop(signal);
  await app.close();
  await cache.close();
  await database.close();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
if (bot) await bot.launch();
logger.info('SlipPilot AI started');
