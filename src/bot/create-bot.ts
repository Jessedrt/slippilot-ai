import { Telegraf } from 'telegraf';
import { createBot as createLegacyBot } from './create-bot-legacy.js';
import { BOT_COMMANDS, homeMenu } from './menu.js';

export { automaticLegCount as automaticGameCount } from '../slips/odds-target.js';

/** Telegram remains essential for signed Mini App authentication and opt-in alert delivery.
 * Conversational betting workflows now live exclusively in the Mini App. */
export function createBot(...args: Parameters<typeof createLegacyBot>): ReturnType<typeof createLegacyBot> {
  const [deps] = args;
  if (!deps.config.TELEGRAM_BOT_TOKEN) return null;
  const bot = new Telegraf(deps.config.TELEGRAM_BOT_TOKEN);
  const launch = 'AUREX now works entirely in the Mini App. Open the intelligence desk to build slips, analyze or edit booking codes, trim selections and manage your watchlist. No wager is placed by the Telegram launcher.';
  bot.start(async (ctx) => {
    // Telegram retains old command menus until setMyCommands is called again.
    // Do this on /start, not on every Vercel serverless cold start.
    try { await ctx.telegram.setMyCommands([...BOT_COMMANDS]); }
    catch (error) { deps.logger.warn({ err: error }, 'Could not update Telegram launcher commands'); }
    await ctx.reply(launch, homeMenu());
  });
  bot.command(['app', 'menu', 'help'], async (ctx) => {
    await ctx.reply(launch, homeMenu());
  });
  // Old inline keyboard callback messages may remain in existing chats.
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCbQuery('Open the AUREX Mini App for all analysis tools.');
    await ctx.reply(launch, homeMenu());
  });
  bot.on('message', async (ctx) => {
    await ctx.reply(launch, homeMenu());
  });
  bot.catch((error) => deps.logger.error({ err: error }, 'AUREX launcher failed'));
  return bot;
}
