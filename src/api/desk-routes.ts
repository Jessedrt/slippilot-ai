import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SportyBetProvider, SportyBetEvent } from '../sportybet/contracts.js';
import { lagosCalendarDay } from '../sportybet/discovery.js';

const sportSchema = z.object({ sport: z.enum(['football', 'basketball']) });
const watchlistSchema = z.object({ ids: z.array(z.string().min(1).max(100)).max(24) });

function publicEvent(event: SportyBetEvent) {
  return {
    id: event.providerEventId,
    sport: undefined,
    league: event.league || 'Competition not supplied',
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    startsAt: event.startsAt.toISOString(),
    status: event.status,
  };
}

/** Routes share the Telegram init-data preHandler installed by registerMiniAppRoutes. */
export function registerDeskRoutes(app: FastifyInstance, sportyBet: SportyBetProvider): void {
  app.post('/api/miniapp/fixtures', async (request) => {
    const { sport } = sportSchema.parse(request.body);
    const now = new Date();
    const date = lagosCalendarDay(now);
    const events = await sportyBet.listEvents(sport);
    const seen = new Set<string>();
    const fixtures = events
      .filter((event) => {
        if (seen.has(event.providerEventId)) return false;
        seen.add(event.providerEventId);
        return lagosCalendarDay(event.startsAt) === date &&
          (event.status === 'live' ||
            (event.status === 'scheduled' && event.startsAt.getTime() > now.getTime()));
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, 24)
      .map((event) => ({ ...publicEvent(event), sport }));
    return { sport, date, refreshedAt: now.toISOString(), fixtures, source: 'SportyBet fixture feed',
      disclaimer: 'Fixtures are provider-supplied; this list does not confirm that a bettable market is currently available.' };
  });

  app.post('/api/miniapp/watchlist-refresh', async (request) => {
    const { ids } = watchlistSchema.parse(request.body);
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const fixture = await sportyBet.getEvent(id);
        return fixture ? { id, available: true, fixture: publicEvent(fixture) } :
          { id, available: false, reason: 'Fixture no longer returned by the provider.' };
      } catch {
        return { id, available: false, reason: 'Provider did not respond for this fixture.' };
      }
    }));
    return { refreshedAt: new Date().toISOString(), results,
      disclaimer: 'Updates happen only when you press Refresh. Automatic Telegram alerts are not enabled.' };
  });
}
