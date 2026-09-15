import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('production configuration', () => {
  it('requires Telegram webhook configuration and managed data services', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: '1234567890:token',
        TELEGRAM_WEBHOOK_SECRET: 'valid_webhook_secret',
      }),
    ).toThrow(/DATABASE_URL must not use localhost/);
  });

  it('accepts a complete production configuration with SportyBet disabled', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      TELEGRAM_BOT_TOKEN: '1234567890:token',
      TELEGRAM_WEBHOOK_SECRET: 'valid_webhook_secret',
      DATABASE_URL: 'postgresql://user:pass@example.com:5432/slippilot',
      REDIS_URL: 'rediss://example.com:6379',
      SPORTYBET_PROVIDER_ENABLED: 'false',
    });
    expect(config.SPORTYBET_PROVIDER_ENABLED).toBe(false);
  });
});
