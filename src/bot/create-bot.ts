import { Markup, Telegraf } from 'telegraf';
import type { Logger } from 'pino';
import { IntentParser } from '../ai/intent-parser.js';
import type { AppConfig } from '../config/env.js';
import type { ConversationStore } from '../services/conversation-store.js';
import { plans } from '../subscriptions/plans.js';
import { HELP_MESSAGE, START_MESSAGE } from './messages.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import { SportyBetSlipBuilder } from '../booking/workflow.js';

interface BotDependencies {
  config: AppConfig;
  logger: Logger;
  conversations: ConversationStore;
  sportyBet: SportyBetProvider;
  intents?: IntentParser;
}

const chooseCount = Markup.inlineKeyboard([
  [Markup.button.callback('3', 'count:3'), Markup.button.callback('5', 'count:5')],
  [Markup.button.callback('10', 'count:10'), Markup.button.callback('Custom', 'count:custom')],
]);

export function createBot(deps: BotDependencies): Telegraf | null {
  if (!deps.config.TELEGRAM_BOT_TOKEN) {
    deps.logger.warn('SlipPilot AI Telegram bot disabled: TELEGRAM_BOT_TOKEN is missing');
    return null;
  }
  const bot = new Telegraf(deps.config.TELEGRAM_BOT_TOKEN);
  const parser = deps.intents ?? new IntentParser();
  const slipBuilder = new SportyBetSlipBuilder(deps.sportyBet);
  bot.start((ctx) => ctx.reply(START_MESSAGE));
  bot.help((ctx) => ctx.reply(HELP_MESSAGE));
  bot.command('clear', async (ctx) => {
    await deps.conversations.clear(String(ctx.from.id));
    await ctx.reply('🧹 SlipPilot AI context cleared.');
  });
  bot.command('pricing', (ctx) =>
    ctx.reply(
      `💎 SlipPilot AI Plans\n\nFree: ${plans.free.dailyAnalyses} analyses/day, slips up to ${plans.free.maximumSlipSize}.\n\nPro: higher limits, advanced statistics, screenshots, history and optimization.`,
    ),
  );
  bot.command('subscription', (ctx) =>
    ctx.reply('📋 Current plan: Free\n\nUse /pricing to compare plans.'),
  );
  for (const command of ['today', 'football', 'basketball'] as const) {
    bot.command(command, async (ctx) => {
      const state = await deps.conversations.get(String(ctx.from.id));
      await deps.conversations.set(String(ctx.from.id), {
        ...state,
        lastSport: command === 'basketball' ? 'basketball' : 'football',
      });
      await ctx.reply('How many games do you want?', chooseCount);
    });
  }
  bot.command('markets', (ctx) =>
    ctx.reply('🔎 Send a fixture, for example: “Explore Arsenal vs Chelsea”.'),
  );
  bot.command('analyze', (ctx) =>
    ctx.reply('🧠 Send the match, ticket, screenshot, or code to analyze.'),
  );
  bot.command('readcode', (ctx) =>
    ctx.reply('🎟️ Paste a SportyBet code. I’ll use a supported resolver when one is configured.'),
  );
  bot.command('slip', async (ctx) => {
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply('You do not have an active slip yet.');
      return;
    }
    await ctx.reply(
      `🎟 Slip ready\n\n${state.currentSlip.selections.length} selections\n\nNo wager has been submitted.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Generate SportyBet Code', 'sportybet:generate')],
        [Markup.button.callback('Remove Weakest', 'slip:remove-weakest'), Markup.button.callback('Explore Markets', 'slip:markets')],
      ]),
    );
  });
  bot.command('history', (ctx) => ctx.reply('🕘 No saved history is available in this session.'));
  bot.action(/^count:(\d+)$/, async (ctx) => {
    const count = Number(ctx.match[1]);
    const state = await deps.conversations.get(String(ctx.from.id));
    await deps.conversations.set(String(ctx.from.id), {
      ...state,
      lastIntent: {
        action: 'discover',
        gameCount: count,
        ...(state.lastSport ? { sport: state.lastSport } : {}),
        marketPreferences: [],
        screenshotIntent: false,
      },
    });
    await ctx.answerCbQuery();
    await ctx.reply(
      `✅ ${count} ${state.lastSport ?? 'sports'} games requested.\n\nCurrent fixtures require a configured sports provider; I won’t invent matches or live odds.`,
    );
  });
  bot.action('count:custom', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Send the number of games you want (1–30).');
  });
  bot.action('sportybet:generate', async (ctx) => {
    await ctx.answerCbQuery('Refreshing SportyBet odds…');
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply('I don’t have an active slip to book.');
      return;
    }
    try {
      const preparation = await slipBuilder.prepare(state.currentSlip.selections);
      if (preparation.status === 'unavailable') {
        await ctx.reply(
          `⚠ Market unavailable\n\n${preparation.selection.fixture.homeTeam} vs ${preparation.selection.fixture.awayTeam}\n${preparation.selection.selectionName}\n\n${preparation.reason}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('Replace Selection', 'slip:replace-unavailable')],
            [Markup.button.callback('Remove Selection', 'slip:remove-unavailable')],
          ]),
        );
        return;
      }
      if (preparation.status === 'odds_changed') {
        await ctx.reply(
          `⚠ Odds changed\n\nOld: ${preparation.previousOdds.toFixed(2)}\nCurrent: ${preparation.currentOdds.toFixed(2)}`,
          Markup.inlineKeyboard([
            [Markup.button.callback('Generate Anyway', 'sportybet:generate-anyway')],
            [Markup.button.callback('Re-optimize', 'slip:reoptimize'), Markup.button.callback('Cancel', 'sportybet:cancel')],
          ]),
        );
        return;
      }
      const code = await slipBuilder.createCode(preparation);
      await ctx.reply(
        `✅ SportyBet booking code created\n\nCode:\n${code}\n\nSelections: ${preparation.selections.length}\nOdds at creation: ${preparation.currentOdds.toFixed(2)}\n\nNo wager was submitted.`,
        Markup.inlineKeyboard([[Markup.button.callback('Analyze Again', 'sportybet:analyze-again')]]),
      );
    } catch (error) {
      deps.logger.warn({ err: error }, 'SportyBet code creation failed');
      await ctx.reply(`SportyBet is temporarily unavailable. Your analyzed slip has been saved.`);
    }
  });
  bot.action('sportybet:cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.reply('Code creation cancelled. Your slip is unchanged.');
  });
  bot.action('sportybet:generate-anyway', async (ctx) => {
    await ctx.answerCbQuery('Refreshing once more…');
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply('I don’t have an active slip to book.');
      return;
    }
    try {
      const preparation = await slipBuilder.prepare(state.currentSlip.selections);
      if (preparation.status === 'unavailable') {
        await ctx.reply(`⚠ Market unavailable\n\n${preparation.reason}`);
        return;
      }
      const code = await deps.sportyBet.createBookingCode(preparation.selections);
      await ctx.reply(
        `✅ SportyBet booking code created\n\nCode:\n${code}\n\nSelections: ${preparation.selections.length}\nOdds at creation: ${preparation.currentOdds.toFixed(2)}\n\nNo wager was submitted.`,
      );
    } catch (error) {
      deps.logger.warn({ err: error }, 'SportyBet code creation after odds confirmation failed');
      await ctx.reply('SportyBet is temporarily unavailable. Your analyzed slip has been saved.');
    }
  });
  bot.on('photo', async (ctx) => {
    const state = await deps.conversations.get(String(ctx.from.id));
    await deps.conversations.set(String(ctx.from.id), {
      ...state,
      lastIntent: {
        action: 'read_screenshot',
        marketPreferences: [],
        screenshotIntent: true,
      },
    });
    await ctx.reply(
      '📸 Screenshot received. Vision extraction requires AI_PROVIDER, AI_API_KEY, and a vision-capable AI_MODEL.',
    );
  });
  bot.on('text', async (ctx) => {
    const userId = String(ctx.from.id);
    const intent = await parser.parse(ctx.message.text.slice(0, 2000));
    const state = await deps.conversations.get(userId);
    await deps.conversations.set(userId, {
      ...state,
      lastIntent: intent,
      ...(intent.sport ? { lastSport: intent.sport } : {}),
    });
    if (intent.action === 'discover' && !intent.gameCount && !intent.minimumGameCount) {
      await ctx.reply('How many games do you want?', chooseCount);
      return;
    }
    if (intent.action === 'read_code' && intent.bookingCode) {
      try {
        const selections = await deps.sportyBet.resolveBookingCode(intent.bookingCode);
        const odds = selections.reduce((total, selection) => total * selection.odds, 1);
        await ctx.reply(
          `🎟 SportyBet code analysis\n\nCode: ${intent.bookingCode.toUpperCase()}\nSelections: ${selections.length}\nCurrent combined odds: ${odds.toFixed(2)}\n\nOdds may change. No wager was submitted.`,
        );
      } catch (error) {
        deps.logger.info({ err: error }, 'SportyBet code could not be resolved');
        await ctx.reply('I could not load that SportyBet code. Check the code or try again shortly.');
      }
      return;
    }
    if (intent.action === 'modify_slip' && !state.currentSlip) {
      await ctx.reply('I don’t have an active slip to edit. Build or analyze one first.');
      return;
    }
    const summary = [
      intent.sport ? `Sport: ${intent.sport}` : null,
      intent.gameCount ? `Games: ${intent.gameCount}` : null,
      intent.targetOdds ? `Target odds: ${intent.targetOdds}` : null,
      intent.minimumConfidence ? `Minimum confidence: ${intent.minimumConfidence}%` : null,
    ]
      .filter(Boolean)
      .join('\n');
    await ctx.reply(
      `🧠 SlipPilot AI understood\n\n${summary || `Intent: ${intent.action}`}\n\nLive recommendations require configured sports and market providers. Predictions are never guaranteed.`,
    );
  });
  bot.catch((error) => deps.logger.error({ err: error }, 'SlipPilot AI Telegram handler failed'));
  return bot;
}
