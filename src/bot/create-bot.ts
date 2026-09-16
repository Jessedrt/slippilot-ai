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
  hydrateBookingCodeSelections,
  parseTypedPicks,
  screenshotPickRequests,
} from '../sportybet/importer.js';
import { extractXPostUrl, XPostReader } from '../social/x-post-reader.js';

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

const importedSlipActions = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('🛡 Make safer', 'slip:make-safer'),
      Markup.button.callback('🗑 Remove weakest', 'slip:remove-weakest'),
    ],
    [
      Markup.button.callback('🔄 Replace a game', 'slip:replace-prompt'),
      Markup.button.callback('🎯 Change target odds', 'slip:target-prompt'),
    ],
    [
      Markup.button.callback('✂️ Split into 2', 'quick:split:2'),
      Markup.button.callback('✂️ Split into 3', 'quick:split:3'),
    ],
    [Markup.button.callback('🎟 Generate new code', 'sportybet:generate')],
  ]);

export function automaticGameCount(targetOdds: number, riskMode: unknown = 'balanced'): number {
  const desiredLegOdds =
    riskMode === 'conservative' ? 1.35 : riskMode === 'aggressive' ? 1.8 : 1.55;
  return Math.max(2, Math.min(12, Math.ceil(Math.log(targetOdds) / Math.log(desiredLegOdds))));
}

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
    await reply('⚡ Building and AI-checking your slip…');
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
    const rows = approvedSelections
      .slice(0, 6)
      .map(
        (selection, index) =>
          `${index + 1}. ${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam}\n   ${selection.selectionName} @ ${selection.odds.toFixed(2)} · AI ${selection.confidenceScore.toFixed(0)}%`,
      );
    const rejected = analyzedSelections.length - approvedSelections.length;
    const hidden = approvedSelections.length - rows.length;
    await reply(
      `🧠 ${approvedSelections.length} AI-reviewed ${sport} picks\n\n${rows.join('\n')}${hidden ? `\n\n+ ${hidden} more saved in your active slip` : ''}\n\nCombined odds: ${combinedOdds.toFixed(2)} · ${analyzedSlip.riskMode} mode${rejected ? `\nRemoved by AI: ${rejected}` : ''}\n\nEstimates only. No wager was placed.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🎟 Generate Code', 'sportybet:generate')],
        [
          Markup.button.webApp(
            '⚡ Open Full Slip in Mini App',
            'https://slippilot-ai.vercel.app/app/',
          ),
        ],
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

async function importBookingCode(
  deps: BotDependencies,
  userId: string,
  state: ConversationState,
  code: string,
  reply: (message: string, extra?: ReturnType<typeof Markup.inlineKeyboard>) => Promise<unknown>,
): Promise<void> {
  const imported = await deps.sportyBet.resolveBookingCode(code);
  const selections = await hydrateBookingCodeSelections(deps.sportyBet, imported);
  if (!selections.length) {
    throw new Error('The code has no active selections that can be edited safely.');
  }
  const preferredMode = state.preferences.riskMode;
  const slip: SlipDraft = {
    id: crypto.randomUUID(),
    selections,
    riskMode:
      preferredMode === 'conservative' ||
      preferredMode === 'balanced' ||
      preferredMode === 'aggressive'
        ? preferredMode
        : 'balanced',
  };
  await analyzeEditedSlip(
    deps,
    userId,
    state,
    slip,
    reply,
    `🎟 Imported code ${code.toUpperCase()} and completed AI review`,
  );
  await reply(
    'What would you like me to do with this slip? Pick an option or type an edit such as “Remove game 3”.',
    importedSlipActions(),
  );
}

export function createBot(deps: BotDependencies): Telegraf | null {
  if (!deps.config.TELEGRAM_BOT_TOKEN) {
    deps.logger.warn('AUREX Telegram bot disabled: TELEGRAM_BOT_TOKEN is missing');
    return null;
  }
  const bot = new Telegraf(deps.config.TELEGRAM_BOT_TOKEN);
  const parser = deps.intents ?? new IntentParser();
  const slipBuilder = new SportyBetSlipBuilder(deps.sportyBet);
  const xPostReader = new XPostReader();
  let welcomePhoto = 'https://slippilot-ai.vercel.app/assets/aurex-welcome-neon.png';
  bot.start(async (ctx) => {
    try {
      const message = await ctx.replyWithPhoto(welcomePhoto, {
        caption: START_MESSAGE,
        ...homeMenu(),
      });
      welcomePhoto = message.photo.at(-1)?.file_id ?? welcomePhoto;
    } catch {
      await ctx.reply(START_MESSAGE, homeMenu());
    }
  });
  bot.help((ctx) => ctx.reply(HELP_MESSAGE, homeMenu()));
  bot.command('menu', (ctx) => ctx.reply('⚡ What would you like to do?', homeMenu()));
  bot.command('app', (ctx) =>
    ctx.reply(
      'Enter the AUREX intelligence desk to build, inspect, refine and prepare codes.',
      Markup.inlineKeyboard([
        [
          Markup.button.webApp(
            '◆ Open AUREX Intelligence Desk',
            'https://slippilot-ai.vercel.app/app/',
          ),
        ],
      ]),
    ),
  );
  bot.command('clear', async (ctx) => {
    await deps.conversations.clear(String(ctx.from.id));
    await ctx.reply('🧹 AUREX context cleared.');
  });
  bot.command('pricing', (ctx) =>
    ctx.reply(
      `💎 AUREX Plans\n\nFree: ${plans.free.dailyAnalyses} analyses/day, slips up to ${plans.free.maximumSlipSize}.\n\nPro: higher limits, advanced statistics, screenshots, history and optimization.`,
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
  const presetSportMenu = (preset: 'daily5' | 'rollover') =>
    Markup.inlineKeyboard([
      [
        Markup.button.callback('⚽ Football', `preset:${preset}:football`),
        Markup.button.callback('🏀 Basketball', `preset:${preset}:basketball`),
      ],
      [Markup.button.callback('‹ Back to Menu', 'home:menu')],
    ]);
  bot.command('daily5', (ctx) =>
    ctx.reply(
      '🎯 Build today’s AI-reviewed slip near 5 odds. Choose a sport:',
      presetSportMenu('daily5'),
    ),
  );
  bot.command('rollover', (ctx) =>
    ctx.reply(
      '🔁 Build today’s lower-variance slip near 2 odds. Choose a sport:',
      presetSportMenu('rollover'),
    ),
  );
  bot.command('markets', (ctx) =>
    ctx.reply('🔎 Send a fixture, for example: “Explore Arsenal vs Chelsea”.'),
  );
  bot.command('analyze', (ctx) =>
    ctx.reply('🧠 Send the match, ticket, screenshot, or code to analyze.'),
  );
  bot.command('readcode', (ctx) =>
    ctx.reply(
      '🎟️ Paste a SportyBet code or a public X/Twitter post link. I’ll extract any code in the post text and make it easy to copy.',
    ),
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
    await ctx.reply('AUREX · PRIVATE INTELLIGENCE DESK', homeMenu());
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
  bot.action(/^home:(daily5|rollover)$/, async (ctx) => {
    const preset = ctx.match[1] as 'daily5' | 'rollover';
    await ctx.answerCbQuery();
    await ctx.reply(
      preset === 'daily5'
        ? '🎯 Choose a sport for today’s 5-odds build:'
        : '🔁 Choose a sport for today’s 2-odds rollover build:',
      presetSportMenu(preset),
    );
  });
  bot.action(/^preset:(daily5|rollover):(football|basketball)$/, async (ctx) => {
    const preset = ctx.match[1] as 'daily5' | 'rollover';
    const sport = ctx.match[2] as 'football' | 'basketball';
    await ctx.answerCbQuery('Building from today’s live markets…');
    const userId = String(ctx.from.id);
    const state = await deps.conversations.get(userId);
    await sendLiveSlip(
      deps,
      userId,
      { ...state, lastSport: sport },
      sport,
      preset === 'daily5' ? 5 : 3,
      preset === 'daily5' ? 5 : 2,
      (message, extra) => ctx.reply(message, extra),
    );
  });
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
  for (const quickEdit of [
    { action: 'slip:make-safer', instruction: 'Make this slip safer' },
    { action: 'slip:remove-weakest', instruction: 'Remove the weakest one' },
  ] as const) {
    bot.action(quickEdit.action, async (ctx) => {
      await ctx.answerCbQuery('Updating and re-analyzing…');
      const userId = String(ctx.from.id);
      const state = await deps.conversations.get(userId);
      if (!state.currentSlip) {
        await ctx.reply('I don’t have an active slip to edit. Paste a code or build one first.');
        return;
      }
      try {
        await ctx.sendChatAction('typing');
        const intent = await parser.parse(quickEdit.instruction);
        const nextState: ConversationState = { ...state, lastIntent: intent };
        const edited = await editSlip(state.currentSlip, {
          intent,
          rawText: quickEdit.instruction,
          sportyBet: deps.sportyBet,
        });
        await analyzeEditedSlip(deps, userId, nextState, edited, (message, extra) =>
          ctx.reply(message, extra),
        );
      } catch (error) {
        deps.logger.warn({ err: error, action: quickEdit.action }, 'Quick slip edit failed');
        await ctx.reply(
          error instanceof Error
            ? `I could not apply that edit: ${error.message}`
            : 'I could not apply that edit.',
        );
      }
    });
  }
  bot.action('slip:replace-prompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Which game should I replace? Send, for example: “Replace game 3”.');
  });
  bot.action('slip:target-prompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      'What combined odds should I target? Send, for example: “Get this close to 10 odds”.',
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
    await ctx.answerCbQuery('Loading live markets…');
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
  bot.action(/^xcode:([A-Z0-9]{4,20})$/, async (ctx) => {
    const code = ctx.match[1]!;
    await ctx.answerCbQuery('Loading booking code…');
    await ctx.sendChatAction('typing');
    try {
      const userId = String(ctx.from.id);
      const state = await deps.conversations.get(userId);
      await importBookingCode(deps, userId, state, code, (message, extra) =>
        ctx.reply(message, extra),
      );
    } catch (error) {
      deps.logger.info({ err: error, code }, 'X post booking code could not be resolved');
      await ctx.reply(
        `I extracted <pre>${escapeCode(code)}</pre>, but could not load it from SportyBet. The code is still copyable above.`,
        { parse_mode: 'HTML' },
      );
    }
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
    const xPostUrl = extractXPostUrl(text);
    if (xPostUrl) {
      await ctx.reply('🔗 Reading the public X post for booking codes…');
      await ctx.sendChatAction('typing');
      try {
        const post = await xPostReader.read(xPostUrl);
        if (!post.bookingCodes.length) {
          await ctx.reply(
            'I could not find a booking code in the public post text. If the code is inside an image, send the image or a screenshot here and I’ll read it.',
          );
          return;
        }
        const codeBlocks = post.bookingCodes
          .map((code, index) => `${index + 1}. <pre>${escapeCode(code)}</pre>`)
          .join('\n');
        await ctx.reply(
          `✅ Booking code${post.bookingCodes.length === 1 ? '' : 's'} found${post.authorName ? ` in ${escapeCode(post.authorName)}’s post` : ''}\n\n${codeBlocks}\nTap a code block to copy it, or analyze it below.`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(
              post.bookingCodes.map((code) => [
                Markup.button.callback(`🎟 Analyze ${code}`, `xcode:${code}`),
              ]),
            ),
          },
        );
      } catch (error) {
        deps.logger.info({ err: error, xPostUrl }, 'X post could not be read');
        await ctx.reply(
          'I could not read that post. It may be private, deleted, or restricted by X. Send a screenshot of the post and I’ll read the code from the image.',
        );
      }
      return;
    }
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
    if (
      intent.action === 'discover' &&
      !intent.targetOdds &&
      !intent.gameCount &&
      !intent.minimumGameCount
    ) {
      await ctx.reply('How many games do you want?', chooseCount);
      return;
    }
    if (intent.action === 'discover') {
      const gameCount =
        intent.gameCount ??
        intent.minimumGameCount ??
        (intent.targetOdds ? automaticGameCount(intent.targetOdds, state.preferences.riskMode) : 3);
      await sendLiveSlip(
        deps,
        userId,
        nextState,
        intent.sport ?? state.lastSport ?? 'football',
        gameCount,
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
        await ctx.reply(
          `🎟 Loading <pre>${escapeCode(intent.bookingCode.toUpperCase())}</pre>, checking its current markets, and running AI analysis…`,
          { parse_mode: 'HTML' },
        );
        await ctx.sendChatAction('typing');
        await importBookingCode(deps, userId, nextState, intent.bookingCode, (message, extra) =>
          ctx.reply(message, extra),
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
      `🧠 AUREX understood\n\n${summary || `Intent: ${intent.action}`}\n\nLive recommendations require configured sports and market providers. Predictions are never guaranteed.`,
    );
  });
  bot.catch((error) => deps.logger.error({ err: error }, 'AUREX Telegram handler failed'));
  return bot;
}
