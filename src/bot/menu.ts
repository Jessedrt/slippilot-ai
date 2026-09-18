import { Markup } from 'telegraf';

// These are the only commands exposed when users start the launcher.
export const BOT_COMMANDS = [
  { command: 'app', description: 'Open the AUREX Mini App' },
  { command: 'menu', description: 'Show the Mini App launcher' },
  { command: 'help', description: 'Open the Mini App for all tools' },
] as const;

export const homeMenu = () => Markup.inlineKeyboard([
  [Markup.button.webApp('◆ Open AUREX Mini App', 'https://slippilot-ai.vercel.app/app/')],
]);

// Retained only to compile historical handlers; never exposed by the launcher.
export const riskMenu = () => homeMenu();
