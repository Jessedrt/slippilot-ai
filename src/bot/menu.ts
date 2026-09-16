import { Markup } from 'telegraf';

export const BOT_COMMANDS = [
  { command: 'menu', description: 'Open the AUREX private desk' },
  { command: 'app', description: 'Open the AUREX intelligence app' },
  { command: 'today', description: 'Build a slip from today’s games' },
  { command: 'football', description: 'Find football selections' },
  { command: 'basketball', description: 'Find basketball selections' },
  { command: 'daily5', description: 'Build today’s slip near 5 odds' },
  { command: 'rollover', description: 'Build today’s safer slip near 2 odds' },
  { command: 'slip', description: 'Show your active slip' },
  { command: 'split', description: 'Split your active slip intelligently' },
  { command: 'code', description: 'Generate a SportyBet booking code' },
  { command: 'risk', description: 'Choose a risk mode' },
  { command: 'analyze', description: 'Analyze a match, ticket or screenshot' },
  { command: 'readcode', description: 'Analyze a SportyBet booking code' },
  { command: 'help', description: 'See examples and instructions' },
  { command: 'clear', description: 'Start a fresh conversation' },
] as const;

export const homeMenu = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.webApp(
        '◆ Open AUREX Intelligence Desk',
        'https://slippilot-ai.vercel.app/app/',
      ),
    ],
    [
      Markup.button.callback('⚽ Football', 'home:football'),
      Markup.button.callback('🏀 Basketball', 'home:basketball'),
    ],
    [
      Markup.button.callback('🎯 Daily 5 Odds', 'home:daily5'),
      Markup.button.callback('🔁 2 Odds Rollover', 'home:rollover'),
    ],
    [
      Markup.button.callback('◈ My Portfolio', 'home:slip'),
      Markup.button.callback('◇ Risk Profile', 'home:risk'),
    ],
  ]);

export const riskMenu = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('🛡 Conservative', 'risk:conservative'),
      Markup.button.callback('⚖️ Balanced', 'risk:balanced'),
    ],
    [Markup.button.callback('🔥 Aggressive', 'risk:aggressive')],
    [Markup.button.callback('‹ Back to Menu', 'home:menu')],
  ]);
