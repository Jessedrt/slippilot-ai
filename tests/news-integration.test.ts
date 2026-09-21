import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes } from '../src/api/mini-app-routes.js';
import { normalizeSportsNews, registerNewsRoutes } from '../src/api/news-routes.js';
import { loadConfig } from '../src/config/env.js';

const botToken = '1234567890:news-test-token';
function signedInitData(): string {
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'news-test',
    user: JSON.stringify({ id: 42 }) });
  const checked = [...data.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  data.set('hash', createHmac('sha256', secret).update(checked).digest('hex'));
  return data.toString();
}
afterEach(() => vi.unstubAllEnvs());

describe('source-linked sports news integration', () => {
  it('allows preview to load without bot secrets, but never authorizes a news request without Telegram', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(loadConfig({ NODE_ENV: 'production' }).TELEGRAM_BOT_TOKEN).toBeUndefined();
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, { sportyBet: {} as never, slipAnalyzer: {} as never,
      screenshotAnalyzer: {} as never });
    const search = vi.fn(() => Promise.resolve({ results: { web: [], news: [] } }));
    registerNewsRoutes(app, { search }, true);
    const result = await app.inject({ method: 'POST', url: '/api/miniapp/news', payload: { sport: 'football' } });
    expect(result.statusCode).toBe(503);
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires signed session, returns only genuine news, deduplicates and caches queries', async () => {
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, { telegramBotToken: botToken, sportyBet: {} as never,
      slipAnalyzer: {} as never, screenshotAnalyzer: {} as never });
    const search = vi.fn(() => Promise.resolve({ results: { web: [
      { url: 'https://website.example/general', title: 'A web page', snippets: [] }], news: [
      { url: 'https://publisher.example/story?campaign=1', title: 'A real publisher headline',
        description: 'This is a publisher summary.', snippets: [], page_age: new Date().toISOString() },
      { url: 'https://publisher.example/story?campaign=2', title: 'Duplicate tracking URL', snippets: [] },
      { url: 'javascript:alert(1)', title: 'Unsafe headline', snippets: [] },
    ] } }));
    registerNewsRoutes(app, { search }, true);
    const unauthorized = await app.inject({ method: 'POST', url: '/api/miniapp/news', payload: { sport: 'football' } });
    expect(unauthorized.statusCode).toBe(401);
    const headers = { 'x-telegram-init-data': signedInitData() };
    const first = await app.inject({ method: 'POST', url: '/api/miniapp/news', headers,
      payload: { sport: 'football' } });
    expect(first.statusCode).toBe(200);
    const data = first.json<{ articles: Array<{ url: string; title: string }>; source: string }>();
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0]?.title).toBe('A real publisher headline');
    expect(data.source).toContain('You.com');
    const again = await app.inject({ method: 'POST', url: '/api/miniapp/news', headers,
      payload: { sport: 'football' } });
    expect(again.statusCode).toBe(200); expect(search).toHaveBeenCalledTimes(1);
    const invalid = await app.inject({ method: 'POST', url: '/api/miniapp/news', headers,
      payload: { sport: 'news-from-untrusted-query' } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('returns a clear unavailable state instead of fabricating headlines', async () => {
    const app = Fastify(); await app.register(sensible);
    registerMiniAppRoutes(app, { telegramBotToken: botToken, sportyBet: {} as never,
      slipAnalyzer: {} as never, screenshotAnalyzer: {} as never });
    registerNewsRoutes(app, { search: () => Promise.reject(new Error('provider offline')) }, false);
    const result = await app.inject({ method: 'POST', url: '/api/miniapp/news',
      headers: { 'x-telegram-init-data': signedInitData() }, payload: { sport: 'all' } });
    expect(result.statusCode).toBe(503);
    const output = normalizeSportsNews([{ url: 'https://publisher.example/live', title: 'Story',
      snippets: [], page_age: 'unknown' }]);
    expect(output[0]?.publishedAt).toBeNull();
    await app.close();
  });
});
