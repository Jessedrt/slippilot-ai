import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerMiniAppRoutes, type MiniAppDependencies } from '../src/api/mini-app-routes.js';
import { registerWatchRoutes } from '../src/api/watch-routes.js';
import type { WatchService } from '../src/watch/watch-service.js';

const token = '1234567890:watch-routes-test-bot';
const cronSecret = 'very-long-test-cron-secret';
function auth(userId: number, includeUser = true): string {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: `watch-${userId}` });
  if (includeUser) fields.set('user', JSON.stringify({ id: userId }));
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return fields.toString();
}
const priorEnv = process.env.VERCEL_ENV;
afterEach(() => { if (priorEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = priorEnv; });
function setup() {
  const service = {
    state: vi.fn((id: string) => Promise.resolve({ enabled: false, items: [], owner: id, alertsReady: false })),
    toggle: vi.fn(() => Promise.resolve({ enabled: false, items: [] })),
    settings: vi.fn(() => Promise.resolve({ enabled: true, items: [] })),
    mute: vi.fn(() => Promise.resolve({ enabled: false, items: [] })),
    check: vi.fn(() => Promise.resolve({ checked: 0, changed: 0, unavailable: 0, delivered: 0 })),
    clear: vi.fn(() => Promise.resolve({ enabled: false, items: [] })),
    monitor: vi.fn(() => Promise.resolve({ users: 0, checked: 0, changed: 0, unavailable: 0, delivered: 0 })),
  };
  const app = Fastify();
  const ready = app.register(sensible).then(() => {
    registerMiniAppRoutes(app, { telegramBotToken: token } as MiniAppDependencies);
    registerWatchRoutes(app, service as unknown as WatchService, cronSecret);
    return app.ready();
  });
  return { app, service, ready };
}
describe('AUREX 5.3 API protection', () => {
  it('requires signed Telegram data, uses signed user IDs and never trusts the payload identity', async () => {
    const { app, service, ready } = setup();
    await ready;
    try {
      const noAuth = await app.inject({ method: 'POST', url: '/api/miniapp/watch/state' });
      expect(noAuth.statusCode).toBe(401);
      const fakeAuth = await app.inject({ method: 'POST', url: '/api/miniapp/watch/state',
        headers: { 'x-telegram-init-data': auth(42).replace('watch-42', 'watch-43') } });
      expect(fakeAuth.statusCode).toBe(401);
      const first = await app.inject({ method: 'POST', url: '/api/miniapp/watch/state',
        headers: { 'x-telegram-init-data': auth(42) }, payload: { telegramId: '99999' } });
      const second = await app.inject({ method: 'POST', url: '/api/miniapp/watch/state',
        headers: { 'x-telegram-init-data': auth(43) } });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json<{ owner: string }>().owner).toBe('42');
      expect(second.json<{ owner: string }>().owner).toBe('43');
      expect(service.state).toHaveBeenCalledWith('42');
      expect(service.state).toHaveBeenCalledWith('43');
      const noUser = await app.inject({ method: 'POST', url: '/api/miniapp/watch/state',
        headers: { 'x-telegram-init-data': auth(42, false) } });
      expect(noUser.statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('only accepts explicit opt-in and valid quiet times, and delegates server-owned fixture state', async () => {
    const { app, service, ready } = setup();
    await ready;
    const headers = { 'x-telegram-init-data': auth(42) };
    try {
      const preference = await app.inject({ method: 'POST', url: '/api/miniapp/watch/settings', headers,
        payload: { enabled: true, quietStart: '22:00', quietEnd: '07:00' } });
      expect(preference.statusCode).toBe(200);
      expect(service.settings).toHaveBeenCalledWith('42', true, '22:00', '07:00');
      const invalid = await app.inject({ method: 'POST', url: '/api/miniapp/watch/settings', headers,
        payload: { enabled: true, quietStart: '99:99', quietEnd: null } });
      expect(invalid.statusCode).not.toBe(200);
      const watch = await app.inject({ method: 'POST', url: '/api/miniapp/watch/toggle', headers,
        payload: { eventId: 'real-event', sport: 'football', watch: true, telegramId: '999' } });
      expect(watch.statusCode).not.toBe(200);
      const valid = await app.inject({ method: 'POST', url: '/api/miniapp/watch/toggle', headers,
        payload: { eventId: 'real-event', sport: 'football', watch: true } });
      expect(valid.statusCode).toBe(200);
      expect(service.toggle).toHaveBeenCalledWith('42', 'real-event', 'football', true);
    } finally { await app.close(); }
  });
  it('never permits unauthenticated or preview-only cron execution', async () => {
    const { app, service, ready } = setup();
    await ready;
    try {
      process.env.VERCEL_ENV = 'preview';
      const preview = await app.inject({ method: 'GET', url: '/api/cron/watchlist',
        headers: { authorization: `Bearer ${cronSecret}` } });
      expect(preview.statusCode).toBe(404);
      process.env.VERCEL_ENV = 'production';
      const unauth = await app.inject({ method: 'GET', url: '/api/cron/watchlist' });
      const wrong = await app.inject({ method: 'GET', url: '/api/cron/watchlist',
        headers: { authorization: 'Bearer incorrect' } });
      expect(unauth.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(service.monitor).not.toHaveBeenCalled();
      const allowed = await app.inject({ method: 'GET', url: '/api/cron/watchlist',
        headers: { authorization: `Bearer ${cronSecret}` } });
      expect(allowed.statusCode).toBe(200);
      expect(service.monitor).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
