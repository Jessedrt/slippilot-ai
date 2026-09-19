import type { Telegraf } from 'telegraf';
import { BOT_COMMANDS, MINI_APP_URL } from './menu.js';

/** Stable, public HTTPS endpoint. Never register a preview URL or an old redirect. */
export const TELEGRAM_WEBHOOK_URL = new URL('/api/telegram', MINI_APP_URL).toString();

type TelegramApi = Pick<Telegraf['telegram'],
  'getMe' | 'getWebhookInfo' | 'setWebhook' | 'setMyCommands'>;

/**
 * Repair missing, stale or failing Telegram delivery when a production Vercel
 * function starts. No polling, token in URL, dropped updates or per-message
 * webhook mutations. Safe to repeat across independent serverless instances.
 */
export async function ensureProductionWebhook(
  api: TelegramApi,
  secret: string,
  expectedUsername = 'AurexIQBot',
): Promise<boolean> {
  const identity = await api.getMe();
  if (identity.username.toLowerCase() !== expectedUsername.toLowerCase()) {
    throw new Error(`Configured Telegram bot is @${identity.username}, expected @${expectedUsername}. Check TELEGRAM_BOT_TOKEN in Vercel Production.`);
  }

  const current = await api.getWebhookInfo();
  const missingMessages = Array.isArray(current.allowed_updates) &&
    current.allowed_updates.length > 0 && !current.allowed_updates.includes('message');
  const recentDeliveryError = typeof current.last_error_date === 'number' &&
    current.last_error_date >= Math.floor(Date.now() / 1000) - 3600;
  if (current.url === TELEGRAM_WEBHOOK_URL && !missingMessages && !recentDeliveryError) return false;

  await api.setWebhook(TELEGRAM_WEBHOOK_URL, {
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  // Command registration is convenience only: a failure cannot undo a working webhook.
  try { await api.setMyCommands([...BOT_COMMANDS]); } catch { /* retry on a future deployment */ }
  return true;
}
