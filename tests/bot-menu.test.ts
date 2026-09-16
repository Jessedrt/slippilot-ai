import { describe, expect, it } from 'vitest';
import { BOT_COMMANDS } from '../src/bot/menu.js';

describe('Telegram command menu', () => {
  it('keeps commands concise, unique and discoverable', () => {
    const names = BOT_COMMANDS.map((item) => item.command);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining(['menu', 'football', 'basketball', 'slip', 'split', 'code', 'risk']),
    );
    expect(BOT_COMMANDS.every((item) => item.description.length <= 256)).toBe(true);
  });
});
