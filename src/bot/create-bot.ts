import { Telegraf } from 'telegraf';
import type { createBot as createLegacyBot } from './create-bot-legacy.js';
import { BOT_COMMANDS, homeMenu, LAUNCH_MESSAGE } from './menu.js';

export { automaticLegCount as automaticGameCount } from '../slips/odds-target.js';

/** Telegram remains essential for signed Mini App authentication and opt-in alert delivery.
 * Conversational betting workflows now live exclusively in the Mini App. */
export function createBot(...args: Parameters<typeof createLegacyBot>): ReturnType<typeof createLegacyBot> {
  const [deps] = args;
  if (!deps.config.TELEGRAM_BOT_TOKEN) return null;
  const bot = new Telegraf(deps.config.TELEGRAM_BOT_TOKEN);
  bot.start(async (ctx) => {
    // Telegram retains old command menus until setMyCommands is called again.
    // Do this on /start, not on every Vercel serverless cold start.
    try { await ctx.telegram.setMyCommands([...BOT_COMMANDS]); }
    catch (error) { deps.logger.warn({ err: error }, 'Could not update Telegram launcher commands'); }
    await ctx.reply(LAUNCH_MESSAGE, homeMenu());
  });
  bot.command(['app', 'menu', 'help'], async (ctx) => {
    await ctx.reply(LAUNCH_MESSAGE, homeMenu());
  });
  // Old inline keyboard callback messages may remain in existing chats.
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery('Tap Open AUREX Mini App below.');
    await ctx.reply(LAUNCH_MESSAGE, homeMenu());
  });
  // Text, links, photos and other messages all receive a one-tap Mini App launcher.
  // Telegram requires users to tap the Web App button; bots cannot force-open it.
  bot.on('message', async (ctx) => {
    await ctx.reply(LAUNCH_MESSAGE, homeMenu());
  });
  bot.catch((error) => deps.logger.error({ err: error }, 'AUREX launcher failed'));
  return bot;
}
