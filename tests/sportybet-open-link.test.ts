import { readFileSync } from 'node:fs';
import { Markup, type Context } from 'telegraf';
import { describe, expect, it, vi } from 'vitest';
import { sportyBetShareUrl } from '../src/booking/sportybet-share-link.js';
import { attachBookingCodeLink } from '../src/bot/booking-link.js';

const readyMessage = (code: string) =>
  `✅ SportyBet booking code created\n\nCode:\n<pre>${code}</pre>\n\nNo wager was submitted.`;

function recordingContext() {
  const send = vi.fn((...args: [message: string, options?: unknown]) => Promise.resolve({ message_id: args[0].length }));
  const ctx = { reply: send } as unknown as Context;
  attachBookingCodeLink(ctx);
  return { ctx, send };
}

describe('SportyBet booking code links', () => {
  it('builds a website shareCode URL only for valid codes', () => {
    expect(sportyBetShareUrl(' ab12cd ')).toBe('https://www.sportybet.com/?shareCode=AB12CD');
    expect(sportyBetShareUrl('')).toBeNull();
    expect(sportyBetShareUrl('A/B?C')).toBeNull();
    expect(sportyBetShareUrl('A'.repeat(21))).toBeNull();
  });

  it('adds a SportyBet website URL and preserves the existing Analyze Again button', async () => {
    const { ctx, send } = recordingContext();
    await ctx.reply(readyMessage('AB12CD'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('Analyze Again', 'sportybet:analyze-again')]]),
    });
    const options = send.mock.calls[0]?.[1] as {
      parse_mode?: string;
      reply_markup?: { inline_keyboard: Array<Array<{ url?: string; callback_data?: string }>> };
    };
    expect(options.parse_mode).toBe('HTML');
    expect(options.reply_markup?.inline_keyboard[0]?.[0]?.url)
      .toBe('https://www.sportybet.com/?shareCode=AB12CD');
    expect(options.reply_markup?.inline_keyboard[1]?.[0]?.callback_data)
      .toBe('sportybet:analyze-again');
  });

  it('also links split and odds-confirmed codes, but not failed or imported messages', async () => {
    const { ctx, send } = recordingContext();
    await ctx.reply('✅ Split A SportyBet code\n\n<pre>ZX1234</pre>\nNo wager was submitted.', { parse_mode: 'HTML' });
    await ctx.reply(readyMessage('QWER99'), { parse_mode: 'HTML' });
    await ctx.reply('Code not created: <pre>AB12CD</pre>');
    await ctx.reply('✅ SportyBet booking code created <pre>BAD/URL</pre>');
    const splitOptions = send.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: Array<Array<{ url?: string }>> } };
    const confirmedOptions = send.mock.calls[1]?.[1] as { reply_markup?: { inline_keyboard: Array<Array<{ url?: string }>> } };
    expect(splitOptions.reply_markup?.inline_keyboard[0]?.[0]?.url)
      .toContain('shareCode=ZX1234');
    expect(confirmedOptions.reply_markup?.inline_keyboard[0]?.[0]?.url)
      .toContain('shareCode=QWER99');
    expect(send.mock.calls[2]?.[1]).toBeUndefined();
    expect(send.mock.calls[3]?.[1]).toBeUndefined();
  });

  it('labels browser and optional app loader correctly and keeps Copy available', () => {
    const controls = readFileSync(new URL('../public/app/miniapp-controls.js', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../public/app/app.js', import.meta.url), 'utf8');
    expect(controls).toContain("textContent !== 'Booking code ready'");
    expect(controls).toContain('Try SportyBet app / code loader');
    expect(controls).toContain('https://sporty.bet/Load-Booking-Code');
    expect(controls).toContain('View this code on SportyBet website');
    expect(controls).toContain('https://www.sportybet.com/?shareCode=${encodeURIComponent(code)}');
    expect(controls).toContain("appLink.target = '_blank'");
    expect(controls).toContain("webLink.rel = 'noopener noreferrer'");
    expect(controls).toContain('If iOS opens a browser');
    expect(app).toContain('data-copy=');
  });
});
