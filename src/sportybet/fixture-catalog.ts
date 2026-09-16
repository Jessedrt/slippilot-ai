import { z } from 'zod';
import type { Sport } from '../types/domain.js';
import type { SportyBetEvent } from './contracts.js';
import { SPORTYBET_PRIMARY_MARKET_IDS, SPORTYBET_SPORT_IDS, type SportyBetClientOptions } from './SportyBetClient.js';

const eventSchema = z.object({
  eventId: z.string(),
  gameId: z.coerce.string().optional(),
  estimateStartTime: z.coerce.number(),
  status: z.coerce.number(),
  matchStatus: z.string().optional(),
  banned: z.boolean().optional(),
  homeTeamName: z.string(),
  awayTeamName: z.string(),
  sport: z.object({
    id: z.string(),
    category: z.object({
      tournament: z.object({ name: z.string() }).optional(),
    }).optional(),
  }),
});

const PAGE_SIZE = 100;
// Operational bound, not a limit on the user's game count. Never silently report a partial catalogue.
const MAX_PAGES = 50;
type RawEvent = z.infer<typeof eventSchema>;

export class SportyBetFixtureCatalog {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly region: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<Sport, { expiry: number; fixtures: SportyBetEvent[] }>();
  private readonly pending = new Map<Sport, Promise<SportyBetEvent[]>>();

  constructor(options: SportyBetClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.baseUrl ?? 'https://www.sportybet.com').replace(/\/$/, '');
    this.region = options.region ?? 'ng';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
  }

  async listEvents(sport: Sport): Promise<SportyBetEvent[]> {
    const cached = this.cache.get(sport);
    if (cached && cached.expiry > Date.now()) return cached.fixtures;
    const existing = this.pending.get(sport);
    if (existing) return existing;
    const loading = this.loadAllPages(sport).then((fixtures) => {
      this.cache.set(sport, { expiry: Date.now() + this.cacheTtlMs, fixtures });
      return fixtures;
    });
    this.pending.set(sport, loading);
    try {
      return await loading;
    } finally {
      this.pending.delete(sport);
    }
  }

  private async loadAllPages(sport: Sport): Promise<SportyBetEvent[]> {
    const byId = new Map<string, SportyBetEvent>();
    let total: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL(`/api/${this.region}/factsCenter/pcUpcomingEvents`, this.baseUrl);
      url.search = new URLSearchParams({
        sportId: SPORTYBET_SPORT_IDS[sport],
        marketId: SPORTYBET_PRIMARY_MARKET_IDS[sport],
        pageSize: String(PAGE_SIZE),
        pageNum: String(page),
      }).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let payload: unknown;
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Current-Country': this.region.toUpperCase(),
            Origin: this.baseUrl,
            Referer: `${this.baseUrl}/${this.region}/`,
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`SportyBet fixture page ${page} returned HTTP ${response.status}.`);
        payload = await response.json() as unknown;
      } finally {
        clearTimeout(timeout);
      }
      const response = z.object({ bizCode: z.coerce.number(), data: z.unknown() }).parse(payload);
      if (response.bizCode !== 10_000) {
        throw new Error(`SportyBet rejected fixture page ${page}: ${response.bizCode}.`);
      }
      const body = response.data;
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const parsedTotal = z.object({ totalNum: z.coerce.number().int().nonnegative().optional() })
          .passthrough().safeParse(body);
        if (parsedTotal.success && parsedTotal.data.totalNum !== undefined) total = parsedTotal.data.totalNum;
      }
      const rawEvents: RawEvent[] = [];
      const visit = (value: unknown, tournament?: string): void => {
        const parsed = eventSchema.safeParse(value);
        if (parsed.success) {
          rawEvents.push(parsed.data);
          const event = parsed.data;
          if (event.sport.id !== SPORTYBET_SPORT_IDS[sport]) return;
          const status: SportyBetEvent['status'] = event.banned || event.status >= 3
            ? 'cancelled'
            : /finished|ended/i.test(event.matchStatus ?? '')
              ? 'finished'
              : event.status === 1 || /live|period|quarter|half/i.test(event.matchStatus ?? '')
                ? 'live' : 'scheduled';
          const league = event.sport.category?.tournament?.name ?? tournament;
          byId.set(event.eventId, {
            providerEventId: event.eventId,
            ...(event.gameId ? { displayEventId: event.gameId } : {}),
            homeTeam: event.homeTeamName,
            awayTeam: event.awayTeamName,
            startsAt: new Date(event.estimateStartTime),
            status,
            ...(league ? { league } : {}),
          });
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((item) => visit(item, tournament));
        } else if (value && typeof value === 'object') {
          const node = value as Record<string, unknown>;
          const nestedTournament = typeof node.name === 'string' &&
            (Array.isArray(node.events) || Array.isArray(node.eventList)) ? node.name : tournament;
          Object.values(node).forEach((item) => visit(item, nestedTournament));
        }
      };
      visit(body);
      if (total !== undefined && page * PAGE_SIZE >= total) return [...byId.values()];
      if (rawEvents.length === 0) {
        if (total !== undefined && (page - 1) * PAGE_SIZE < total) {
          throw new Error(`SportyBet fixture catalogue incomplete: page ${page} was empty before ${total} listed fixtures were retrieved.`);
        }
        return [...byId.values()];
      }
      if (total === undefined && rawEvents.length < PAGE_SIZE) return [...byId.values()];
    }
    throw new Error(`SportyBet fixture catalogue exceeds ${MAX_PAGES} pages; refusing to silently omit leagues.`);
  }
}
