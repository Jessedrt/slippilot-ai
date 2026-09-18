import { describe, expect, it } from 'vitest';
import { BOT_COMMANDS, homeMenu } from '../src/bot/menu.js';

describe('Telegram Mini App launcher', () => {
  it('offers only the app, menu and help commands, never conversational betting tools', () => {
    const names = BOT_COMMANDS.map((item) => item.command);
    expect(names).toEqual(['app', 'menu', 'help']);
    expect(new Set(names).size).toBe(names.length);
    expect(BOT_COMMANDS.every((item) => item.description.length <= 256)).toBe(true);
    const keyboard = homeMenu().reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    expect(JSON.stringify(keyboard)).toContain('https://slippilot-ai.vercel.app/app/');
  });
});
