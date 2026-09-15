import { MetricsService } from './admin/metrics.js';
import { createServer } from './api/server.js';
import { createBot } from './bot/create-bot.js';
import { loadConfig } from './config/env.js';
import { RedisCache } from './services/cache.js';
import { PrismaConversationStore, PrismaDatabase } from './database/client.js';
import { DisabledSportsProvider } from './sports/provider.js';
import { createSportyBetProvider } from './sportybet/provider.js';
import { createLogger } from './utils/logger.js';

const config = loadConfig();
const logger = createLogger(config);
const cache = new RedisCache(config.REDIS_URL);
const sports = new DisabledSportsProvider();
const sportyBet = createSportyBetProvider(config);
const metrics = new MetricsService();
const database = new PrismaDatabase();
const conversations = new PrismaConversationStore(database.client);

const app = await createServer(logger, { config, metrics, cache, database, sports, sportyBet });
const bot = createBot({ config, logger, conversations });

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
