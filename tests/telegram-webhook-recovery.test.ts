import { describe, expect, it, vi } from 'vitest';
import { ensureProductionWebhook, TELEGRAM_WEBHOOK_URL } from '../src/bot/ensure-webhook.js';

const SECRET = 'aurex-test-secret-not-real';
const createTelegram = (url = '', username = 'AurexIQBot') => ({
  getMe: vi.fn().mockResolvedValue({ username }),
  getWebhookInfo: vi.fn().mockResolvedValue({ url }),
  setWebhook: vi.fn().mockResolvedValue(true),
  setMyCommands: vi.fn().mockResolvedValue(true),
});
const verify = (api: ReturnType<typeof createTelegram>) =>
  ensureProductionWebhook(api, SECRET);

describe('AUREX Telegram production webhook recovery', () => {
  it('registers the canonical HTTPS endpoint without dropping Telegram messages', async () => {
    const api = createTelegram();
    expect(TELEGRAM_WEBHOOK_URL).toBe('https://aurexiq.vercel.app/api/telegram');
    expect(await verify(api)).toBe(true);
    expect(api.setWebhook).toHaveBeenCalledWith(TELEGRAM_WEBHOOK_URL, {
      secret_token: SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    expect(api.setMyCommands).toHaveBeenCalledOnce();
  });

  it('recovers the production @slippilotbot token with the actual Mini App URL', async () => {
    const api = createTelegram('', 'slippilotbot');
    expect(await verify(api)).toBe(true);
    expect(api.setWebhook).toHaveBeenCalledWith(TELEGRAM_WEBHOOK_URL, expect.objectContaining({
      secret_token: SECRET, drop_pending_updates: false,
    }));
  });

  it('does not mutate a healthy, correctly registered webhook', async () => {
    const api = createTelegram(TELEGRAM_WEBHOOK_URL);
    expect(await verify(api)).toBe(false);
    expect(api.setWebhook).not.toHaveBeenCalled();
  });

  it('repairs an obsolete domain, callback-only configuration, or recent delivery failure', async () => {
    const old = createTelegram('https://slippilot-ai.vercel.app/api/telegram');
    expect(await verify(old)).toBe(true);
    const callbacksOnly = createTelegram(TELEGRAM_WEBHOOK_URL);
    callbacksOnly.getWebhookInfo.mockResolvedValue({ url: TELEGRAM_WEBHOOK_URL,
      allowed_updates: ['callback_query'] });
    expect(await verify(callbacksOnly)).toBe(true);
    const failing = createTelegram(TELEGRAM_WEBHOOK_URL);
    failing.getWebhookInfo.mockResolvedValue({ url: TELEGRAM_WEBHOOK_URL,
      last_error_date: Math.floor(Date.now() / 1000) });
    expect(await verify(failing)).toBe(true);
  });

  it('refuses to hijack unrelated bots or bypass an explicitly chosen identity', async () => {
    const api = createTelegram('', 'ClipJetDownloaderBot');
    await expect(verify(api)).rejects.toThrow('expected @AurexIQBot');
    expect(api.setWebhook).not.toHaveBeenCalled();
    const legacy = createTelegram('', 'slippilotbot');
    await expect(ensureProductionWebhook(legacy, SECRET, 'AurexIQBot2')).rejects.toThrow('expected @AurexIQBot2');
    expect(legacy.setWebhook).not.toHaveBeenCalled();
  });

  it('keeps the webhook registered even if command menu setup fails', async () => {
    const api = createTelegram();
    api.setMyCommands.mockRejectedValue(new Error('Telegram rate limited command setup'));
    expect(await verify(api)).toBe(true);
    expect(api.setWebhook).toHaveBeenCalledOnce();
  });
});
