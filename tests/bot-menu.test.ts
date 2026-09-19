import { describe, expect, it } from 'vitest';
import { BOT_COMMANDS, homeMenu, LAUNCH_MESSAGE, MINI_APP_URL } from '../src/bot/menu.js';

describe('Telegram Mini App launcher', () => {
  it('offers only the app, menu and help commands, never conversational betting tools', () => {
    const names = BOT_COMMANDS.map((item) => item.command);
    expect(names).toEqual(['app', 'menu', 'help']);
    expect(new Set(names).size).toBe(names.length);
    expect(BOT_COMMANDS.every((item) => item.description.length <= 256)).toBe(true);
  });

  it('provides a direct one-tap Web App button to the canonical production domain', () => {
    const keyboard = homeMenu().reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    expect(MINI_APP_URL).toBe('https://aurexiq.vercel.app/app/');
    expect(keyboard[0]?.[0]).toMatchObject({
      text: '◆ Open AUREX Mini App',
      web_app: { url: MINI_APP_URL },
    });
  });

  it('tells people to tap the Mini App button and offers a direct fallback link', () => {
    expect(LAUNCH_MESSAGE).toContain('Tap “Open AUREX Mini App”');
    expect(LAUNCH_MESSAGE).toContain(MINI_APP_URL);
    expect(LAUNCH_MESSAGE).not.toContain('slippilot-ai.vercel.app');
  });
});
