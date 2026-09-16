import { createApplication } from './app.js';

const { appPromise, bot, cache, config, database, logger } = createApplication();
const app = await appPromise;

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Stopping AUREX');
  bot?.stop(signal);
  await app.close();
  await cache.close();
  await database.close();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: config.HOST });
if (bot && config.NODE_ENV !== 'production') await bot.launch();
logger.info('AUREX started');
