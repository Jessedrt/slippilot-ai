import { Telegraf } from 'telegraf';
import { createBot as createLegacyBot } from './create-bot-legacy.js';
import { attachBookingCodeLink } from './booking-link.js';
import { oddsDiscoveryText } from '../slips/odds-target.js';
import type { Sport } from '../types/domain.js';

export { automaticLegCount as automaticGameCount } from '../slips/odds-target.js';

const ODDS_PROMPT_TTL_MS = 20 * 60_000;
const TARGET_ODDS = /\b(\d+(?:[.,]\d+)?)\s*(?:combined\s+|total\s+)?odds\b/i;
const BARE_ODDS = /^\s*(\d+(?:[.,]\d+)?)\s*(?:odds?)?\s*$/i;
const DISCOVERY = /^(?:give me|find|build|i want|football|basketball|games?|matches?|picks?|today|\d+(?:[.,]\d+)?\s*odds\b)/i;
const EDIT = /\b(?:change|replace|remove|split|reduce|increase|edit|analy[sz]e|booking code|read code)\b/i;

/** Odds-first entry point; existing slip analysis, booking, research and editing handlers are retained. */
export function createBot(...args: Parameters<typeof createLegacyBot>): ReturnType<typeof createLegacyBot> {
  const [deps] = args;
  const legacy = createLegacyBot(deps);
  if (!legacy) return null;
  const bot = new Telegraf(deps.config.TELEGRAM_BOT_TOKEN!);

  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const userId = String(ctx.from.id);
    const state = await deps.conversations.get(userId);
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    const message = ctx.message && 'text' in ctx.message ? ctx.message : undefined;
    const text = message?.text.trim() ?? '';
    const command = /^\/(today|football|basketball)(?:@\w+)?(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
    const menuSport = /^home:(football|basketball)$/.exec(data ?? '')?.[1];
    const oldCountButton = /^count:(?:\d+|custom)$/.test(data ?? '');

    if (command || menuSport || oldCountButton) {
      if (data) await ctx.answerCbQuery();
      const sport: Sport = command === 'basketball' || menuSport === 'basketball'
        ? 'basketball'
        : command === 'football' || menuSport === 'football'
          ? 'football' : state.lastSport ?? 'football';
      const supplied = TARGET_ODDS.exec(text)?.[1];
      const targetOdds = supplied ? Number(supplied.replace(',', '.')) : undefined;
      if (targetOdds !== undefined && Number.isFinite(targetOdds) && targetOdds >= 1.01 && message) {
        const riskMode = state.preferences.riskMode;
        const preferences = { ...state.preferences, oddsPrompt: undefined, oddsPromptAt: undefined };
        await deps.conversations.set(userId, { ...state, lastSport: sport, preferences });
        message.text = oddsDiscoveryText(sport, targetOdds, riskMode);
        return next();
      }
      await deps.conversations.set(userId, {
        ...state,
        lastSport: sport,
        preferences: { ...state.preferences, oddsPrompt: sport, oddsPromptAt: Date.now() },
      });
      await ctx.reply(`🎯 What combined odds should I target for today's ${sport} games? Send a number such as 2, 5, 10 or 20. I'll choose how many matches to use.`);
      return;
    }

    if (!message) return next();
    const pending = state.preferences.oddsPrompt;
    const waiting = (pending === 'football' || pending === 'basketball') &&
      Date.now() - Number(state.preferences.oddsPromptAt) < ODDS_PROMPT_TTL_MS;
    if (waiting && /^cancel$/i.test(text)) {
      await deps.conversations.set(userId, {
        ...state,
        preferences: { ...state.preferences, oddsPrompt: undefined, oddsPromptAt: undefined },
      });
      await ctx.reply('Odds request cancelled.');
      return;
    }

    const bare = waiting ? BARE_ODDS.exec(text)?.[1] : undefined;
    const requested = bare ?? (DISCOVERY.test(text) && !EDIT.test(text) ? TARGET_ODDS.exec(text)?.[1] : undefined);
    const promptedWithoutOdds = DISCOVERY.test(text) && !EDIT.test(text) && !TARGET_ODDS.test(text) &&
      !/^\//.test(text) && !waiting;

    if (requested !== undefined) {
      const targetOdds = Number(requested.replace(',', '.'));
      if (!Number.isFinite(targetOdds) || targetOdds < 1.01) {
        await ctx.reply('Enter valid combined odds of at least 1.01, such as 2, 5, 10 or 20.');
        return;
      }
      const sport: Sport = /basketball|nba|wnba|euroleague/i.test(text) ? 'basketball'
        : /football|soccer/i.test(text) ? 'football' : waiting ? pending : state.lastSport ?? 'football';
      const riskMode = state.preferences.riskMode;
      const preferences = { ...state.preferences, oddsPrompt: undefined, oddsPromptAt: undefined };
      await deps.conversations.set(userId, { ...state, lastSport: sport, preferences });
      // The older parser's automatic default was capped at twelve; supply the derived count explicitly.
      message.text = oddsDiscoveryText(sport, targetOdds, riskMode);
      return next();
    }
    if (waiting) {
      await ctx.reply('Please send your target combined odds as a number (e.g. 5, 10 or 20), or type Cancel.');
      return;
    }
    if (promptedWithoutOdds) {
      const sport: Sport = /basketball|nba|wnba|euroleague/i.test(text) ? 'basketball'
        : /football|soccer/i.test(text) ? 'football' : state.lastSport ?? 'football';
      await deps.conversations.set(userId, {
        ...state,
        lastSport: sport,
        preferences: { ...state.preferences, oddsPrompt: sport, oddsPromptAt: Date.now() },
      });
      await ctx.reply(`What combined odds should I target for today's ${sport} games? I'll choose the number of games automatically.`);
      return;
    }
    return next();
  });

  // Add a load-in-SportyBet URL to successful booking-code replies from the existing handlers.
  bot.use((ctx, next) => {
    attachBookingCodeLink(ctx);
    return next();
  });
  bot.use(legacy.middleware());
  bot.catch((error) => deps.logger.error({ err: error }, 'AUREX Telegram handler failed'));
  return bot;
}
