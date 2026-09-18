import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SportyBetProvider, SportyBetEvent } from '../sportybet/contracts.js';
import { lagosCalendarDay } from '../sportybet/discovery.js';

const sportSchema = z.object({
  sport: z.enum(['football', 'basketball']), query: z.string().max(80).default(''),
  league: z.string().max(120).default(''),
  status: z.enum(['all', 'scheduled', 'live']).default('all'),
  kickoff: z.enum(['all', 'next3h', 'evening']).default('all'),
});
const watchlistSchema = z.object({ ids: z.array(z.string().min(1).max(100)).max(24) });
function publicEvent(event: SportyBetEvent) {
  return { id: event.providerEventId, league: event.league || 'Competition not supplied',
    homeTeam: event.homeTeam, awayTeam: event.awayTeam,
    startsAt: event.startsAt.toISOString(), status: event.status };
}
function lagosHour(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23',
  }).format(date));
}

/** Routes share the verified Telegram init-data preHandler from registerMiniAppRoutes. */
export function registerDeskRoutes(app: FastifyInstance, sportyBet: SportyBetProvider): void {
  app.post('/api/miniapp/fixtures', async (request) => {
    const filters = sportSchema.parse(request.body);
    const now = new Date();
    const events = await sportyBet.listEvents(filters.sport);
    const seen = new Set<string>();
    const eligible = events.filter((event) => {
      if (!Number.isFinite(event.startsAt.getTime()) || seen.has(event.providerEventId)) return false;
      seen.add(event.providerEventId);
      return event.status === 'live' ||
        (event.status === 'scheduled' && event.startsAt.getTime() > now.getTime());
    });
    // Pick a calendar day based on provider fixtures before applying user filters;
    // never pretend a filtered search miss means the provider has no games today.
    let dayOffset: 0 | 1 | 2 = 0;
    let date = lagosCalendarDay(now);
    let dayEvents: SportyBetEvent[] = [];
    for (const offset of [0, 1, 2] as const) {
      const currentDay = lagosCalendarDay(new Date(now.getTime() + offset * 86_400_000));
      const candidates = eligible.filter((event) => lagosCalendarDay(event.startsAt) === currentDay);
      if (candidates.length || offset === 2) {
        dayOffset = offset; date = currentDay; dayEvents = candidates; break;
      }
    }
    const leagues = [...new Set(dayEvents.map((event) => event.league || 'Competition not supplied'))]
      .sort((a, b) => a.localeCompare(b));
    const query = filters.query.trim().toLocaleLowerCase();
    const league = filters.league.trim().toLocaleLowerCase();
    const matching = dayEvents.filter((event) => {
      if (query && !`${event.homeTeam} ${event.awayTeam} ${event.league || ''}`
        .toLocaleLowerCase().includes(query)) return false;
      if (league && (event.league || 'Competition not supplied').toLocaleLowerCase() !== league) return false;
      if (filters.status !== 'all' && event.status !== filters.status) return false;
      if (filters.kickoff === 'next3h' &&
        (event.startsAt.getTime() < now.getTime() ||
          event.startsAt.getTime() > now.getTime() + 3 * 60 * 60_000)) return false;
      if (filters.kickoff === 'evening' && lagosHour(event.startsAt) < 17) return false;
      return true;
    }).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const fixtures = matching.slice(0, 40).map((event) => ({ ...publicEvent(event), sport: filters.sport }));
    return { sport: filters.sport, date, dayOffset,
      dayLabel: ['today', 'tomorrow', 'the following day'][dayOffset],
      refreshedAt: now.toISOString(), fixtures,
      totalMatching: matching.length, truncated: matching.length > fixtures.length, leagues,
      filters: { query: filters.query.trim(), league: filters.league, status: filters.status,
        kickoff: filters.kickoff }, source: 'SportyBet fixture feed',
      disclaimer: 'Dates reflect the Nigeria/Lagos calendar. Only when a day has zero upcoming or live fixtures is the following day checked, up to two days ahead. Fixture listings do not verify active betting markets.',
    };
  });
  app.post('/api/miniapp/watchlist-refresh', async (request) => {
    const { ids } = watchlistSchema.parse(request.body);
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const fixture = await sportyBet.getEvent(id);
        return fixture ? { id, available: true, fixture: publicEvent(fixture) } :
          { id, available: false, reason: 'Fixture not returned; status unverified, not cancelled.' };
      } catch {
        return { id, available: false, reason: 'Provider did not respond; status unverified.' };
      }
    }));
    return { refreshedAt: new Date().toISOString(), results,
      disclaimer: 'This manual refresh does not send notifications. Opt-in production monitoring is configured separately.' };
  });
}
