import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { WatchService } from '../watch/watch-service.js';

const idSchema = z.string().min(1).max(100);
const toggleSchema = z.object({ eventId: idSchema, sport: z.enum(['football', 'basketball']), watch: z.boolean() }).strict();
const muteSchema = z.object({ eventId: idSchema, muted: z.boolean() }).strict();
const clock = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const settingsSchema = z.object({ enabled: z.boolean(), quietStart: clock.nullable(), quietEnd: clock.nullable() }).strict()
  .refine((input) => (input.quietStart === null) === (input.quietEnd === null), {
    message: 'Set both quiet-hour times, or clear both.', path: ['quietEnd'],
  });
function identity(request: FastifyRequest): string {
  // registerMiniAppRoutes verifies the full Telegram initData signature and age
  // before any /api/miniapp/* route. Never take an identity from request.body.
  const signed = request.headers['x-telegram-init-data'];
  if (typeof signed !== 'string') throw new Error('Signed Telegram identity is required.');
  let user: unknown;
  try { user = JSON.parse(new URLSearchParams(signed).get('user') || 'null'); }
  catch { user = null; }
  const parsed = z.object({ id: z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)]) }).safeParse(user);
  if (!parsed.success) throw new Error('Your Telegram session has no valid user identity.');
  return String(parsed.data.id);
}
function authorized(secret: string, header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export function registerWatchRoutes(app: FastifyInstance, service: WatchService, cronSecret?: string): void {
  app.post('/api/miniapp/watch/state', async (request, reply) => {
    try { return await service.state(identity(request)); }
    catch (error) { if (error instanceof Error && error.message.includes('identity')) return reply.badRequest(error.message); throw error; }
  });
  app.post('/api/miniapp/watch/toggle', async (request) => {
    const data = toggleSchema.parse(request.body);
    const state = await service.toggle(identity(request), data.eventId, data.sport, data.watch);
    return { ...state, ...(await service.state(identity(request))) };
  });
  app.post('/api/miniapp/watch/settings', async (request) => {
    const data = settingsSchema.parse(request.body);
    await service.settings(identity(request), data.enabled, data.quietStart, data.quietEnd);
    return service.state(identity(request));
  });
  app.post('/api/miniapp/watch/mute', async (request) => {
    const data = muteSchema.parse(request.body);
    await service.mute(identity(request), data.eventId, data.muted);
    return service.state(identity(request));
  });
  app.post('/api/miniapp/watch/check', async (request) => {
    const user = identity(request);
    const result = await service.check(user, false);
    return { ...result, state: await service.state(user),
      disclaimer: 'Manual check only. Provider absence is unverified, not a cancellation. No Telegram message was sent.' };
  });
  app.post('/api/miniapp/watch/clear', async (request) => {
    await service.clear(identity(request));
    return service.state(identity(request));
  });
  app.get('/api/cron/watchlist', async (request, reply) => {
    if (!cronSecret || process.env.VERCEL_ENV !== 'production') return reply.notFound();
    if (!authorized(cronSecret, request.headers.authorization)) return reply.unauthorized();
    const result = await service.monitor();
    return { ok: true, ...result, schedule: 'Daily, 08:00 UTC' };
  });
}
