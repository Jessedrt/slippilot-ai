import { Markup } from 'telegraf';

export const BOT_COMMANDS = [
  { command: 'menu', description: 'Open the SlipPilot dashboard' },
  { command: 'app', description: 'Open the SlipPilot Mini App' },
  { command: 'today', description: 'Build a slip from today’s games' },
  { command: 'football', description: 'Find football selections' },
  { command: 'basketball', description: 'Find basketball selections' },
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
    [Markup.button.webApp('⚡ Open SlipPilot Mini App', 'https://slippilot-ai.vercel.app/app/')],
    [
      Markup.button.callback('⚽ Football', 'home:football'),
      Markup.button.callback('🏀 Basketball', 'home:basketball'),
    ],
    [
      Markup.button.callback('🎟 My Slip', 'home:slip'),
      Markup.button.callback('🛡 Risk', 'home:risk'),
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

