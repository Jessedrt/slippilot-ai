import { Markup, type Context } from 'telegraf';
import { sportyBetShareUrl } from '../booking/sportybet-share-link.js';

/** Add a direct-loading button to all successful Telegram booking-code replies. */
export function attachBookingCodeLink(ctx: Context): void {
  const originalReply = ctx.reply.bind(ctx);
  ctx.reply = ((message: string, extra?: Parameters<typeof ctx.reply>[1]) => {
    // Do not add links to pasted, imported, failed or unconfirmed codes.
    if (!/^✅ (?:SportyBet booking code created|Split [A-Z] SportyBet code)\b/.test(message)) {
      return originalReply(message, extra);
    }
    const code = /<pre>([A-Za-z0-9]{4,20})<\/pre>/.exec(message)?.[1];
    const url = code ? sportyBetShareUrl(code) : null;
    if (!url) return originalReply(message, extra);
    const previous = extra?.reply_markup && 'inline_keyboard' in extra.reply_markup
      ? extra.reply_markup.inline_keyboard : [];
    return originalReply(message, {
      ...extra,
      ...Markup.inlineKeyboard([
        [Markup.button.url('↗ Open in SportyBet', url)],
        ...previous,
      ]),
    });
  }) as typeof ctx.reply;
}
