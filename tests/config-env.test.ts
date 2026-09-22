import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';

afterEach(() => vi.unstubAllEnvs());

describe('production configuration', () => {
  it('requires Telegram webhook configuration and managed data services', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
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
    vi.stubEnv('VERCEL_ENV', 'production');
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
  it('allows an unconfigured Vercel Preview to render but never weakens production', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(loadConfig({ NODE_ENV: 'production' }).TELEGRAM_BOT_TOKEN).toBeUndefined();
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });
  it('keeps API-Sports analysis disabled until credentials and rights confirmations exist', () => {
    expect(loadConfig({}).API_SPORTS_ENABLED).toBe(false);
    expect(() => loadConfig({ API_SPORTS_ENABLED: 'true' })).toThrow(/API_SPORTS_KEY/);
    expect(() =>
      loadConfig({
        API_SPORTS_ENABLED: 'true',
        API_SPORTS_KEY: 'rotated-test-key-value',
        API_SPORTS_FOOTBALL_ENABLED: 'true',
      }),
    ).toThrow(/commercial-use approval/);
    const declaredOnly = loadConfig({
      API_SPORTS_ENABLED: 'true',
      API_SPORTS_KEY: 'rotated-test-key-value',
      API_SPORTS_COMMERCIAL_USE_APPROVED: 'true',
      API_SPORTS_FOOTBALL_ENABLED: 'true',
    });
    expect(declaredOnly.API_SPORTS_FOOTBALL_ENABLED).toBe(true);
    expect(declaredOnly.API_SPORTS_DATA_RIGHTS_CONFIRMED).toBe(false);
    expect(
      loadConfig({
        API_SPORTS_ENABLED: 'true',
        API_SPORTS_KEY: 'rotated-test-key-value',
        API_SPORTS_COMMERCIAL_USE_APPROVED: 'true',
        API_SPORTS_DATA_RIGHTS_CONFIRMED: 'true',
        API_SPORTS_FOOTBALL_ENABLED: 'true',
      }).API_SPORTS_DATA_RIGHTS_CONFIRMED,
    ).toBe(true);
  });
});
