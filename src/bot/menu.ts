import { Markup } from 'telegraf';

// Use the production domain directly: Telegram Web App buttons should not rely on redirects.
export const MINI_APP_URL = 'https://aurexiq.vercel.app/app/';

export const LAUNCH_MESSAGE = [
  '◆ AUREX now works in the Mini App.',
  'Tap “Open AUREX Mini App” below to build slips, analyze or edit booking codes, trim selections and manage your watchlist.',
  `If the button does not appear, open: ${MINI_APP_URL}`,
  'No wager is placed by the Telegram launcher.',
].join('\n\n');

// These are the only commands exposed when users start the launcher.
export const BOT_COMMANDS = [
  { command: 'app', description: 'Open the AUREX Mini App' },
  { command: 'menu', description: 'Show the Mini App launcher' },
  { command: 'help', description: 'Open the Mini App for all tools' },
] as const;

export const homeMenu = () => Markup.inlineKeyboard([
  [Markup.button.webApp('◆ Open AUREX Mini App', MINI_APP_URL)],
]);

// Retained only to compile historical handlers; never exposed by the launcher.
export const riskMenu = () => homeMenu();
