import { Markup, Telegraf } from 'telegraf';
import type { Logger } from 'pino';
import { IntentParser } from '../ai/intent-parser.js';
import type { AppConfig } from '../config/env.js';
import type { ConversationState, ConversationStore } from '../services/conversation-store.js';
import { plans } from '../subscriptions/plans.js';
import { EXAMPLES_MESSAGE, HELP_MESSAGE, START_MESSAGE } from './messages.js';
import { homeMenu, riskMenu } from './menu.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import { SportyBetSlipBuilder } from '../booking/workflow.js';
import type { SportsResearchService } from '../research/sports-research.js';
import { buildLiveSlipSnapshot } from '../sportybet/discovery.js';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import type { ScreenshotAnalyzer } from '../ai/screenshot-analyzer.js';
import { SlipSplitter } from '../slips/splitter.js';
import { combinedOdds } from '../slips/optimizer.js';
import { editSlip } from '../slips/editor.js';
import type { SlipDraft } from '../types/domain.js';
import {
  buildImportedSlip,
  parseTypedPicks,
  screenshotPickRequests,
} from '../sportybet/importer.js';

interface BotDependencies {
  config: AppConfig;
  logger: Logger;
  conversations: ConversationStore;
  sportyBet: SportyBetProvider;
  research: SportsResearchService;
  slipAnalyzer: SlipAnalyzer;
  screenshotAnalyzer: ScreenshotAnalyzer;
  intents?: IntentParser;
}

const escapeCode = (code: string): string =>
  code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const chooseCount = Markup.inlineKeyboard([
  [
    Markup.button.callback('2', 'count:2'),
    Markup.button.callback('3', 'count:3'),
    Markup.button.callback('5', 'count:5'),
  ],
  [
    Markup.button.callback('7', 'count:7'),
    Markup.button.callback('10', 'count:10'),
    Markup.button.callback('Custom', 'count:custom'),
  ],
]);

async function analyzeEditedSlip(
  deps: BotDependencies,
  userId: string,
  state: ConversationState,
  slip: SlipDraft,
  reply: (message: string, extra?: ReturnType<typeof Markup.inlineKeyboard>) => Promise<unknown>,
  title = '✏️ Updated and re-analyzed slip',
): Promise<void> {
  const analysis = await deps.slipAnalyzer.analyze(slip.selections);
  const selections = slip.selections
    .map((selection, index) => {
      const result = analysis.selections.find((item) => item.index === index + 1);
      if (!result) throw new Error(`AI analysis missing selection ${index + 1}.`);
      return {
        selection: {
          ...selection,
          modelProbability: result.confidence,
          confidenceScore: result.confidence,
          riskLevel: result.risk,
          reasoning: [result.reason, `AI verdict: ${result.verdict}.`],
        },
        verdict: result.verdict,
      };
    })
    .filter((item) => item.verdict !== 'reject')
    .map((item) => item.selection);
  if (!selections.length) throw new Error('AI rejected every remaining selection.');
  const preferredMode = state.preferences.riskMode;
  const analyzedSlip = {
    ...slip,
    selections,
    riskMode:
      preferredMode === 'conservative' ||
      preferredMode === 'balanced' ||
      preferredMode === 'aggressive'
        ? preferredMode
        : slip.riskMode,
  };
  await deps.conversations.set(userId, {
    ...state,
    currentSlip: analyzedSlip,
    currentSlipId: analyzedSlip.id,
    recentAnalysis: analysis.summary,
    currentSlipAnalysis: { ...analysis, slipId: analyzedSlip.id },
  });
  const rows = selections.map(
    (selection, index) =>
      `${index + 1}. ${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam}\n${selection.selectionName} @ ${selection.odds.toFixed(2)} · AI ${selection.confidenceScore.toFixed(0)}% · ${selection.riskLevel}`,
  );
  await reply(
    `${title}\n\n${rows.join('\n\n')}\n\nCombined odds: ${combinedOdds(selections).toFixed(2)}\nMode: ${analyzedSlip.riskMode}\n\nAI analysis is not a guarantee.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Generate SportyBet Code', 'sportybet:generate')],
    ]),
  );
}

async function sendLiveSlip(
  deps: BotDependencies,
  userId: string,
  state: ConversationState,
  sport: 'football' | 'basketball',
  gameCount: number,
  targetOdds: number | undefined,
  reply: (message: string, extra?: ReturnType<typeof Markup.inlineKeyboard>) => Promise<unknown>,
): Promise<void> {
  try {
    const snapshot = await buildLiveSlipSnapshot(deps.sportyBet, sport, gameCount, targetOdds);
    const analysis = await deps.slipAnalyzer.analyze(snapshot.slip.selections);
    const analyzedSelections = snapshot.slip.selections.map((selection, index) => {
      const result = analysis.selections.find((item) => item.index === index + 1);
      if (!result) throw new Error(`AI analysis missing selection ${index + 1}.`);
      return {
        ...selection,
        modelProbability: result.confidence,
        confidenceScore: result.confidence,
        riskLevel: result.risk,
        reasoning: [result.reason, `AI verdict: ${result.verdict}.`],
      };
    });
    const approvedSelections = analyzedSelections.filter((_, index) => {
      return analysis.selections[index]?.verdict !== 'reject';
    });
    if (approvedSelections.length === 0) {
      throw new Error('AI rejected every candidate selection.');
    }
    const preferredMode = state.preferences.riskMode;
    const analyzedSlip = {
      ...snapshot.slip,
      selections: approvedSelections,
      riskMode:
        preferredMode === 'conservative' ||
        preferredMode === 'balanced' ||
        preferredMode === 'aggressive'
          ? preferredMode
          : snapshot.slip.riskMode,
    };
    const combinedOdds = approvedSelections.reduce((total, selection) => total * selection.odds, 1);
    await deps.conversations.set(userId, {
      ...state,
      lastSport: sport,
      currentSlip: analyzedSlip,
      currentSlipId: analyzedSlip.id,
      recentAnalysis: analysis.summary,
      currentSlipAnalysis: { ...analysis, slipId: analyzedSlip.id },
    });
    const rows = approvedSelections.map(
      (selection, index) =>
        `${index + 1}. ${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam}\n${selection.marketName}: ${selection.selectionName} @ ${selection.odds.toFixed(2)}\nAI: ${selection.confidenceScore.toFixed(0)}% · ${selection.riskLevel} risk · ${selection.reasoning[0]?.slice(0, 120)}`,
    );
    const rejected = analyzedSelections.length - approvedSelections.length;
    await reply(
      `🧠 AI-analyzed live ${sport} slip\n\n${rows.join('\n\n')}\n\nAI summary: ${analysis.summary.slice(0, 300)}${rejected ? `\nRejected and removed: ${rejected}` : ''}\nCombined odds: ${combinedOdds.toFixed(2)}${targetOdds ? `\nRequested target: ${targetOdds.toFixed(2)}` : ''}\n\nOdds can change. Analysis is not a guarantee. No wager was placed.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Generate SportyBet Code', 'sportybet:generate')],
      ]),
    );
  } catch (error) {
    deps.logger.warn(
      { err: error, sport, gameCount },
      'Live discovery or required AI analysis failed',
    );
    await reply(
      'I could not complete the required AI analysis, so I did not offer a booking code. Please try again shortly.',
    );
  }
}

export function createBot(deps: BotDependencies): Telegraf | null {
  if (!deps.config.TELEGRAM_BOT_TOKEN) {
    deps.logger.warn('SlipPilot AI Telegram bot disabled: TELEGRAM_BOT_TOKEN is missing');
    return null;
  }
  const bot = new Telegraf(deps.config.TELEGRAM_BOT_TOKEN);
  const parser = deps.intents ?? new IntentParser();
  const slipBuilder = new SportyBetSlipBuilder(deps.sportyBet);
  bot.start((ctx) => ctx.reply(START_MESSAGE, homeMenu()));
  bot.help((ctx) => ctx.reply(HELP_MESSAGE, homeMenu()));
  bot.command('menu', (ctx) => ctx.reply('⚡ What would you like to do?', homeMenu()));
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
  bot.command('risk', (ctx) =>
    ctx.reply('🛡 Choose how adventurous your selections should be:', riskMenu()),
  );
  bot.command('split', (ctx) =>
    ctx.reply(
      '✂️ How many slips?',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Split into 2', 'quick:split:2'),
          Markup.button.callback('Split into 3', 'quick:split:3'),
        ],
        [Markup.button.callback('‹ Back to Menu', 'home:menu')],
      ]),
    ),
  );
  bot.command('code', async (ctx) => {
    const state = await deps.conversations.get(String(ctx.from.id));
    const ready = Boolean(
      state.currentSlip && state.currentSlipAnalysis?.slipId === state.currentSlip.id,
    );
    await ctx.reply(
      ready
        ? '✅ Your slip passed AI analysis. Tap below to refresh the odds and create its code.'
        : 'Build or import a slip first. I require AI analysis before creating a booking code.',
      ready
        ? Markup.inlineKeyboard([
            [Markup.button.callback('🎟 Generate SportyBet Code', 'sportybet:generate')],
          ])
        : homeMenu(),
    );
  });
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
      state.currentSlipAnalysis?.slipId === state.currentSlip.id
        ? Markup.inlineKeyboard([
            [Markup.button.callback('Generate SportyBet Code', 'sportybet:generate')],
          ])
        : undefined,
    );
  });
  bot.command('history', (ctx) => ctx.reply('🕘 No saved history is available in this session.'));
  bot.action('home:menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('⚡ SlipPilot dashboard', homeMenu());
  });
  for (const sport of ['football', 'basketball'] as const) {
    bot.action(`home:${sport}`, async (ctx) => {
      await ctx.answerCbQuery();
      const state = await deps.conversations.get(String(ctx.from.id));
      await deps.conversations.set(String(ctx.from.id), { ...state, lastSport: sport });
      await ctx.reply(
        `${sport === 'football' ? '⚽' : '🏀'} How many games do you want?`,
        chooseCount,
      );
    });
  }
  bot.action('home:slip', async (ctx) => {
    await ctx.answerCbQuery();
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply(
        'No active slip yet. Choose football or basketball to build one.',
        homeMenu(),
      );
      return;
    }
    await ctx.reply(
      `🎟 Active slip\n\n${state.currentSlip.selections.length} selections · ${combinedOdds(state.currentSlip.selections).toFixed(2)} odds · ${state.currentSlip.riskMode} mode`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🎟 Generate Code', 'sportybet:generate')],
        [
          Markup.button.callback('✂️ Split into 2', 'quick:split:2'),
          Markup.button.callback('✂️ Split into 3', 'quick:split:3'),
        ],
        [Markup.button.callback('‹ Back to Menu', 'home:menu')],
      ]),
    );
  });
  bot.action('home:screenshot', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      '📸 Send a clear, full screenshot now. I’ll read it, match live markets, run AI analysis, and prepare a bookable slip.',
    );
  });
  bot.action('home:examples', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(EXAMPLES_MESSAGE, homeMenu());
  });
  bot.action('home:risk', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('🛡 Choose your risk mode:', riskMenu());
  });
  bot.action(/^risk:(conservative|balanced|aggressive)$/, async (ctx) => {
    const riskMode = ctx.match[1] as SlipDraft['riskMode'];
    const userId = String(ctx.from.id);
    const state = await deps.conversations.get(userId);
    await deps.conversations.set(userId, {
      ...state,
      preferences: { ...state.preferences, riskMode },
      ...(state.currentSlip ? { currentSlip: { ...state.currentSlip, riskMode } } : {}),
    });
    await ctx.answerCbQuery(`${riskMode} mode selected`);
    const icon = riskMode === 'conservative' ? '🛡' : riskMode === 'aggressive' ? '🔥' : '⚖️';
    await ctx.reply(
      `${icon} ${riskMode[0]?.toUpperCase()}${riskMode.slice(1)} mode is active. Nothing is guaranteed.`,
      homeMenu(),
    );
  });
  bot.action(/^quick:split:(2|3)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply('You need an active slip first.', homeMenu());
      return;
    }
    const count = Number(ctx.match[1]);
    try {
      const splits = new SlipSplitter().split(state.currentSlip.selections, count);
      await deps.conversations.set(String(ctx.from.id), { ...state, splitSlips: splits });
      await ctx.reply(
        `✅ Split into ${count}. Each slip is balanced by odds, confidence, risk, league, and kickoff time.`,
        Markup.inlineKeyboard(
          splits.map((_, index) => [
            Markup.button.callback(
              `🎟 Code for Slip ${String.fromCharCode(65 + index)}`,
              `sportybet:split:${index}`,
            ),
          ]),
        ),
      );
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'I could not split that slip.');
    }
  });
  bot.action(/^count:(\d+)$/, async (ctx) => {
    const count = Number(ctx.match[1]);
    const userId = String(ctx.from.id);
    const state = await deps.conversations.get(userId);
    const intent = {
      marketPreferences: [],
      screenshotIntent: false,
      ...state.lastIntent,
      action: 'discover' as const,
      gameCount: count,
      ...(state.lastSport ? { sport: state.lastSport } : {}),
    };
    const nextState: ConversationState = {
      ...state,
      lastIntent: intent,
    };
    await deps.conversations.set(userId, nextState);
    await ctx.answerCbQuery('Loading live markets…');
    await ctx.sendChatAction('typing');
    await sendLiveSlip(
      deps,
      userId,
      nextState,
      state.lastSport ?? 'football',
      count,
      intent.targetOdds,
      (message, extra) => ctx.reply(message, extra),
    );
  });
  bot.action('count:custom', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Send the number of games you want (1–30).');
  });
  bot.action('sportybet:generate', async (ctx) => {
    await ctx.answerCbQuery('Refreshing SportyBet odds…');
    await ctx.sendChatAction('typing');
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply('I don’t have an active slip to book.');
      return;
    }
    if (state.currentSlipAnalysis?.slipId !== state.currentSlip.id) {
      await ctx.reply('AI analysis is required before booking. Build a new analyzed slip first.');
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
            [
              Markup.button.callback('Re-optimize', 'slip:reoptimize'),
              Markup.button.callback('Cancel', 'sportybet:cancel'),
            ],
          ]),
        );
        return;
      }
      const code = await slipBuilder.createCode(preparation);
      await ctx.reply(
        `✅ SportyBet booking code created\n\nCode:\n<pre>${escapeCode(code)}</pre>\n\nSelections: ${preparation.selections.length}\nOdds at creation: ${preparation.currentOdds.toFixed(2)}\n\nNo wager was submitted.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Analyze Again', 'sportybet:analyze-again')],
          ]),
        },
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
  bot.action(/^sportybet:split:(\d+)$/, async (ctx) => {
    const index = Number(ctx.match[1]);
    await ctx.answerCbQuery('Refreshing this split…');
    const state = await deps.conversations.get(String(ctx.from.id));
    const split = state.splitSlips?.[index];
    if (!split || state.currentSlipAnalysis?.slipId !== state.currentSlip?.id) {
      await ctx.reply('That split is no longer available or its AI analysis is stale.');
      return;
    }
    try {
      const preparation = await slipBuilder.prepare(split.selections);
      if (preparation.status === 'unavailable') {
        await ctx.reply(
          `⚠ Split ${String.fromCharCode(65 + index)} cannot be booked: ${preparation.reason}`,
        );
        return;
      }
      if (preparation.status === 'odds_changed') {
        await ctx.reply(
          `⚠ Split ${String.fromCharCode(65 + index)} odds changed from ${preparation.previousOdds.toFixed(2)} to ${preparation.currentOdds.toFixed(2)}.`,
          Markup.inlineKeyboard([
            [Markup.button.callback('Generate at New Odds', `sportybet:split-anyway:${index}`)],
          ]),
        );
        return;
      }
      const code = await slipBuilder.createCode(preparation);
      await ctx.reply(
        `✅ Split ${String.fromCharCode(65 + index)} SportyBet code\n\n<pre>${escapeCode(code)}</pre>\n\nOdds: ${preparation.currentOdds.toFixed(2)}\nNo wager was submitted.`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      deps.logger.warn({ err: error, index }, 'Split booking code creation failed');
      await ctx.reply('SportyBet is temporarily unavailable. Your split is still saved.');
    }
  });
  bot.action(/^sportybet:split-anyway:(\d+)$/, async (ctx) => {
    const index = Number(ctx.match[1]);
    await ctx.answerCbQuery('Refreshing once more…');
    const state = await deps.conversations.get(String(ctx.from.id));
    const split = state.splitSlips?.[index];
    if (!split || state.currentSlipAnalysis?.slipId !== state.currentSlip?.id) {
      await ctx.reply('That split is no longer available or its AI analysis is stale.');
      return;
    }
    try {
      const preparation = await slipBuilder.prepare(split.selections);
      if (preparation.status === 'unavailable') {
        await ctx.reply(`⚠ This split cannot be booked: ${preparation.reason}`);
        return;
      }
      const code = await deps.sportyBet.createBookingCode(preparation.selections);
      await ctx.reply(
        `✅ Split ${String.fromCharCode(65 + index)} SportyBet code\n\n<pre>${escapeCode(code)}</pre>\n\nOdds: ${preparation.currentOdds.toFixed(2)}\nNo wager was submitted.`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      deps.logger.warn({ err: error, index }, 'Confirmed split booking code creation failed');
      await ctx.reply('SportyBet is temporarily unavailable. Your split is still saved.');
    }
  });
  bot.action('sportybet:generate-anyway', async (ctx) => {
    await ctx.answerCbQuery('Refreshing once more…');
    const state = await deps.conversations.get(String(ctx.from.id));
    if (!state.currentSlip) {
      await ctx.reply('I don’t have an active slip to book.');
      return;
    }
    if (state.currentSlipAnalysis?.slipId !== state.currentSlip.id) {
      await ctx.reply('AI analysis is required before booking. Build a new analyzed slip first.');
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
        `✅ SportyBet booking code created\n\nCode:\n<pre>${escapeCode(code)}</pre>\n\nSelections: ${preparation.selections.length}\nOdds at creation: ${preparation.currentOdds.toFixed(2)}\n\nNo wager was submitted.`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      deps.logger.warn({ err: error }, 'SportyBet code creation after odds confirmation failed');
      await ctx.reply('SportyBet is temporarily unavailable. Your analyzed slip has been saved.');
    }
  });
  bot.action('research:sources', async (ctx) => {
    await ctx.answerCbQuery();
    const state = await deps.conversations.get(String(ctx.from.id));
    const sources = state.recentResearch?.sources ?? [];
    await ctx.reply(
      sources.length
        ? `🔎 Sources checked\n\n${sources.map((source, index) => `${index + 1}. ${source.title}\n${source.url}`).join('\n\n')}`
        : 'No recent research sources are stored for this conversation.',
    );
  });
  bot.on('photo', async (ctx) => {
    const userId = String(ctx.from.id);
    const state = await deps.conversations.get(String(ctx.from.id));
    try {
      await ctx.reply('📸 Reading the screenshot and matching teams to live fixtures…');
      await ctx.sendChatAction('upload_photo');
      const photo = ctx.message.photo.at(-1);
      if (!photo) throw new Error('Telegram supplied no image.');
      const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
      const response = await fetch(fileUrl);
      if (!response.ok)
        throw new Error(`Telegram image download failed with HTTP ${response.status}.`);
      const extraction = await deps.screenshotAnalyzer.analyze(
        new Uint8Array(await response.arrayBuffer()),
        response.headers.get('content-type') ?? 'image/jpeg',
      );
      const rows = extraction.items.slice(0, 12).map((item, index) => {
        const details = [
          item.competition,
          item.market,
          item.selection,
          item.odds ? `@ ${item.odds}` : undefined,
          item.matchTime,
        ]
          .filter(Boolean)
          .join(' · ');
        const uncertain = item.uncertainFields.length
          ? `\n⚠ Uncertain: ${item.uncertainFields.join(', ')}`
          : '';
        return `${index + 1}. ${item.homeTeam} vs ${item.awayTeam}${details ? `\n${details}` : ''}\nConfidence: ${Math.round(item.confidence * 100)}%${uncertain}`;
      });
      const codeText = extraction.bookingCodes.length
        ? `\n\nVisible booking codes: ${extraction.bookingCodes.join(', ')}`
        : '';
      const summary = `${rows.join('\n\n')}${codeText}`;
      await deps.conversations.set(userId, {
        ...state,
        recentAnalysis: summary,
        lastIntent: { action: 'read_screenshot', marketPreferences: [], screenshotIntent: true },
      });
      await ctx.reply(
        `📸 Screenshot analysis\n\n${summary || 'No sports fixtures were confidently detected.'}`,
      );
      const requests = screenshotPickRequests(extraction);
      if (requests.length) {
        await ctx.reply(
          '🔎 Matching the readable picks to active SportyBet markets, then running AI analysis…',
        );
        const imported = await buildImportedSlip(deps.sportyBet, requests);
        await analyzeEditedSlip(
          deps,
          userId,
          state,
          imported.slip,
          (message, extra) => ctx.reply(message, extra),
          `📸 Screenshot converted to an AI-analyzed slip${imported.unmatched.length ? `\n\nCould not safely match ${imported.unmatched.length} item(s); they were left out.` : ''}`,
        );
      }
    } catch (error) {
      deps.logger.warn({ err: error }, 'Screenshot analysis failed');
      await ctx.reply(
        'I could not read that screenshot confidently. Please send a clearer full-resolution image.',
      );
    }
  });
  bot.on('text', async (ctx) => {
    const userId = String(ctx.from.id);
    const state = await deps.conversations.get(userId);
    const text = ctx.message.text.slice(0, 2000).trim();
    const customCount = /^(?:[1-9]|[12]\d|30)$/.test(text) ? Number(text) : undefined;
    if (customCount && state.lastIntent?.action === 'discover') {
      const intent = { ...state.lastIntent, gameCount: customCount };
      const nextState: ConversationState = { ...state, lastIntent: intent };
      await deps.conversations.set(userId, nextState);
      await sendLiveSlip(
        deps,
        userId,
        nextState,
        intent.sport ?? state.lastSport ?? 'football',
        customCount,
        intent.targetOdds,
        (message, extra) => ctx.reply(message, extra),
      );
      return;
    }
    const typedPicks = parseTypedPicks(text);
    const isTypedPickImport =
      typedPicks.length >= 2 &&
      /\n|;/.test(text) &&
      /(?:book|pick|win|draw|over|under|btts|both teams)/i.test(text);
    if (isTypedPickImport) {
      try {
        await ctx.reply(
          '📝 Matching your typed picks to live SportyBet markets, then running AI analysis…',
        );
        await ctx.sendChatAction('typing');
        const imported = await buildImportedSlip(deps.sportyBet, typedPicks);
        await analyzeEditedSlip(
          deps,
          userId,
          state,
          imported.slip,
          (message, extra) => ctx.reply(message, extra),
          `📝 Typed picks converted to an AI-analyzed slip${imported.unmatched.length ? `\n\nCould not safely match ${imported.unmatched.length} line(s); they were left out.` : ''}`,
        );
      } catch (error) {
        deps.logger.warn({ err: error }, 'Typed pick import failed');
        await ctx.reply(error instanceof Error ? error.message : 'I could not match those picks.');
      }
      return;
    }
    const intent = await parser.parse(text);
    const nextState: ConversationState = {
      ...state,
      lastIntent: intent,
      ...(intent.sport ? { lastSport: intent.sport } : {}),
    };
    await deps.conversations.set(userId, nextState);
    if (intent.action === 'discover' && !intent.gameCount && !intent.minimumGameCount) {
      await ctx.reply('How many games do you want?', chooseCount);
      return;
    }
    if (intent.action === 'discover') {
      await sendLiveSlip(
        deps,
        userId,
        nextState,
        intent.sport ?? state.lastSport ?? 'football',
        intent.gameCount ?? intent.minimumGameCount ?? 3,
        intent.targetOdds,
        (message, extra) => ctx.reply(message, extra),
      );
      return;
    }
    if (intent.action === 'generate_code') {
      if (!state.currentSlip || state.currentSlipAnalysis?.slipId !== state.currentSlip.id) {
        await ctx.reply(
          'AI analysis is required before booking. Ask me to build a new slip first.',
        );
        return;
      }
      await ctx.reply(
        'Your slip has passed AI analysis. Use the button below to refresh the odds and create the SportyBet code.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Generate SportyBet Code', 'sportybet:generate')],
        ]),
      );
      return;
    }
    if (intent.action === 'show_sources') {
      const sources = state.recentResearch?.sources ?? [];
      await ctx.reply(
        sources.length
          ? `🔎 Sources checked\n\n${sources.map((source, index) => `${index + 1}. ${source.title}\n${source.url}`).join('\n\n')}`
          : 'No recent research sources are stored for this conversation.',
      );
      return;
    }
    if (intent.action === 'research') {
      const teamMatch = /(?:team news for|research)\s+(.+)/i.exec(ctx.message.text);
      const subject = teamMatch?.[1]?.trim() ?? state.lastFixture ?? ctx.message.text;
      const result = await deps.research.researchTeam(subject);
      await deps.conversations.set(userId, {
        ...state,
        lastIntent: intent,
        recentResearch: result,
      });
      const context = result.sources
        .slice(0, 3)
        .map((source) => `• ${source.snippet ?? source.title}`)
        .join('\n');
      await ctx.reply(
        `📰 Fresh context\n\n${context || result.summary}\n\nConfidence: ${result.confidence}%\nSources checked: ${result.sources.length}${result.conflicting ? '\n⚠ Reports conflict; treated as uncertain.' : ''}`,
        result.sources.length
          ? Markup.inlineKeyboard([[Markup.button.callback('Sources', 'research:sources')]])
          : undefined,
      );
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
        await ctx.reply(
          'I could not load that SportyBet code. Check the code or try again shortly.',
        );
      }
      return;
    }
    if (intent.action === 'split_slip') {
      if (!state.currentSlip) {
        await ctx.reply('I don’t have an active slip to split.');
        return;
      }
      try {
        const splits = new SlipSplitter().split(
          state.currentSlip.selections,
          intent.splitCount ?? 2,
        );
        await deps.conversations.set(userId, { ...nextState, splitSlips: splits });
        const sections = splits.map((split, index) => {
          const label = String.fromCharCode(65 + index);
          const picks = split.selections
            .map(
              (selection) =>
                `• ${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam} — ${selection.selectionName}`,
            )
            .join('\n');
          return `Slip ${label}\n${picks}\nOdds: ${split.combinedOdds.toFixed(2)} · Avg confidence: ${split.averageConfidence.toFixed(0)}%`;
        });
        await ctx.reply(
          `🔀 Intelligent split\n\n${sections.join('\n\n')}\n\nBalanced by odds, confidence, risk, sport, league, and kickoff timing. No outcome is guaranteed.`,
          Markup.inlineKeyboard(
            splits.map((_, index) => [
              Markup.button.callback(
                `Generate Code for Slip ${String.fromCharCode(65 + index)}`,
                `sportybet:split:${index}`,
              ),
            ]),
          ),
        );
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : 'I could not split that slip.');
      }
      return;
    }
    if (intent.action === 'modify_slip' && !state.currentSlip) {
      await ctx.reply('I don’t have an active slip to edit. Build or analyze one first.');
      return;
    }
    if (intent.action === 'modify_slip' && state.currentSlip) {
      try {
        await ctx.reply('✏️ Updating the slip, then running the required AI analysis again…');
        const edited = await editSlip(state.currentSlip, {
          intent,
          rawText: text,
          sportyBet: deps.sportyBet,
        });
        await analyzeEditedSlip(deps, userId, nextState, edited, (message, extra) =>
          ctx.reply(message, extra),
        );
      } catch (error) {
        deps.logger.warn({ err: error }, 'Slip edit failed');
        await ctx.reply(
          error instanceof Error
            ? `I could not apply that edit: ${error.message}`
            : 'I could not apply that edit.',
        );
      }
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
