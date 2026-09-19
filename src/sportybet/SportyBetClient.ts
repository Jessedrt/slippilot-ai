import { z } from 'zod';
import type { NormalizedMarket, Sport } from '../types/domain.js';
import type { ProviderSelection, SportyBetEvent } from './contracts.js';

const outcomeSchema = z.object({
  id: z.coerce.string(), odds: z.coerce.number().nonnegative(),
  probability: z.union([z.string(), z.number()]).optional(),
  isActive: z.coerce.number(), desc: z.string(),
}).passthrough();
const marketSchema = z.object({
  id: z.coerce.string(), product: z.coerce.number().optional(),
  desc: z.string().optional(), name: z.string().optional(), group: z.string().optional(),
  status: z.coerce.number(), specifier: z.string().nullish(),
  outcomes: z.array(outcomeSchema), lastOddsChangeTime: z.coerce.number().optional(),
  banned: z.boolean().optional(),
}).passthrough();
const eventSchema = z.object({
  eventId: z.string(), gameId: z.coerce.string().optional(),
  estimateStartTime: z.coerce.number(), status: z.coerce.number(),
  matchStatus: z.string().optional(), homeTeamName: z.string(), awayTeamName: z.string(),
  bookingStatus: z.string().optional(), banned: z.boolean().optional(),
  sport: z.object({ id: z.string(), name: z.string(), category: z.object({
    name: z.string(), tournament: z.object({ name: z.string() }),
  }).optional() }),
  markets: z.array(marketSchema).default([]),
}).passthrough();
const responseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ bizCode: z.coerce.number(), message: z.string().optional(), data });
const eventsResponseSchema = responseSchema(z.unknown());
const eventResponseSchema = responseSchema(eventSchema);
const refreshResponseSchema = responseSchema(z.array(eventSchema));
const shareResponseSchema = responseSchema(z.object({
  shareCode: z.string(), shareURL: z.string().optional(),
  deadline: z.union([z.string(), z.number()]).optional(),
}).passthrough());
const bookingResponseSchema = responseSchema(z.object({
  shareCode: z.string(), shareURL: z.string().optional(),
  deadline: z.union([z.string(), z.number()]).optional(),
  outcomes: z.array(eventSchema).default([]),
  unavailableOutcomes: z.array(z.unknown()).default([]),
}).passthrough());

type RawEvent = z.infer<typeof eventSchema>;
export interface SportyBetClientOptions {
  baseUrl?: string; region?: string; timeoutMs?: number; minIntervalMs?: number;
  maxConcurrency?: number; maxRetries?: number; cacheTtlMs?: number;
  fetch?: typeof fetch; sleep?: (milliseconds: number) => Promise<void>;
}
export interface BookingSelection extends ProviderSelection {
  homeTeam: string; awayTeam: string; marketName: string; selectionName: string;
  startsAt: Date; sport: Sport; tournament: string;
}
export interface BookingCodeDetails {
  code: string; shareURL?: string; deadline?: string | number;
  selections: BookingSelection[]; currentOdds: number; unavailableSelections: unknown[];
}
export class SportyBetHttpError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message); this.name = 'SportyBetHttpError';
  }
}

// Sportradar sport identifiers are distinct from SportyBet's market identifiers.
// Tennis's match-winner market 186 is published in SportyBet browser configuration.
// Handball's ordinary result-market ID 1 must be verified against the live supplier;
// any unavailable fixture or market is reported as unavailable, never substituted.
const sportIds: Record<Sport, string> = {
  football: 'sr:sport:1', basketball: 'sr:sport:2',
  tennis: 'sr:sport:5', handball: 'sr:sport:6',
};
const primaryMarketIds: Record<Sport, string> = {
  football: '1', basketball: '219', tennis: '186', handball: '1',
};

export class SportyBetClient {
  private readonly baseUrl: string;
  private readonly region: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private active = 0;
  private lastStartedAt = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(options: SportyBetClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://www.sportybet.com').replace(/\/$/, '');
    this.region = options.region ?? 'ng';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.minIntervalMs = options.minIntervalMs ?? 350;
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.maxRetries = options.maxRetries ?? 2;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async fetchFixtures(sport: Sport): Promise<SportyBetEvent[]> {
    const raw = await this.cached(`fixtures:${sport}`, async () => {
      const data = await this.request('GET', '/factsCenter/pcUpcomingEvents', {
        sportId: sportIds[sport], marketId: primaryMarketIds[sport],
        pageSize: '100', pageNum: '1',
      });
      const response = eventsResponseSchema.parse(data);
      this.assertBusinessSuccess(response);
      return this.collectEvents(response.data);
    });
    return raw.map((event) => this.normalizeEvent(event));
  }

  async getEvent(eventId: string): Promise<SportyBetEvent | null> {
    const raw = await this.getRawEvent(eventId).catch((error: unknown) => {
      if (error instanceof SportyBetHttpError && error.status === 404) return null;
      throw error;
    });
    return raw ? this.normalizeEvent(raw) : null;
  }
  async getMarkets(eventId: string): Promise<NormalizedMarket[]> {
    return this.normalizeMarkets(await this.getRawEvent(eventId));
  }
  async refreshSelections(selections: ProviderSelection[]): Promise<BookingSelection[]> {
    this.validateSelectionInput(selections);
    const response = refreshResponseSchema.parse(
      await this.request('POST', '/factsCenter/Outcomes', undefined,
        selections.map((selection) => this.toTuple(selection)), false),
    );
    this.assertBusinessSuccess(response);
    const refreshed = this.extractSelections(response.data);
    return selections.map((selection) => {
      const match = refreshed.find((item) => this.sameTuple(item, selection));
      if (!match) throw new Error(`SportyBet selection unavailable: ${this.describe(selection)}`);
      return match;
    });
  }
  async createBookingCode(selections: ProviderSelection[]): Promise<BookingCodeDetails> {
    await this.validateCurrentSelections(selections);
    const refreshed = await this.refreshSelections(selections);
    const response = shareResponseSchema.parse(await this.request('POST', '/orders/share',
      undefined, { selections: refreshed.map((selection) => this.toTuple(selection)) }, false));
    this.assertBusinessSuccess(response);
    return {
      code: response.data.shareCode,
      ...(response.data.shareURL ? { shareURL: response.data.shareURL } : {}),
      ...(response.data.deadline !== undefined ? { deadline: response.data.deadline } : {}),
      selections: refreshed, currentOdds: this.combinedOdds(refreshed), unavailableSelections: [],
    };
  }
  async getBookingCode(code: string): Promise<BookingCodeDetails> {
    if (!/^[A-Za-z0-9]{4,20}$/.test(code)) throw new Error('Invalid SportyBet booking code.');
    const response = bookingResponseSchema.parse(await this.request('GET',
      `/orders/share/${encodeURIComponent(code.toUpperCase())}`));
    this.assertBusinessSuccess(response);
    const selections = this.extractSelections(response.data.outcomes);
    return {
      code: response.data.shareCode,
      ...(response.data.shareURL ? { shareURL: response.data.shareURL } : {}),
      ...(response.data.deadline !== undefined ? { deadline: response.data.deadline } : {}),
      selections, currentOdds: this.combinedOdds(selections),
      unavailableSelections: response.data.unavailableOutcomes,
    };
  }
  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = responseSchema(z.unknown()).parse(await this.request('GET', '/factsCenter/sportList'));
      this.assertBusinessSuccess(response);
      return { ok: true, detail: 'Public browser-facing SportyBet interface reachable' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async getRawEvent(eventId: string, useCache = true): Promise<RawEvent> {
    if (!/^sr:match:\d+$/.test(eventId)) throw new Error('Invalid SportyBet event ID.');
    const load = async () => {
      const response = eventResponseSchema.parse(await this.request('GET', '/factsCenter/event',
        { eventId, productId: '3' }));
      this.assertBusinessSuccess(response);
      return response.data;
    };
    return useCache ? this.cached(`event:${eventId}`, load) : load();
  }
  private async validateCurrentSelections(selections: ProviderSelection[]): Promise<void> {
    this.validateSelectionInput(selections);
    const events = new Map<string, RawEvent>();
    for (const selection of selections) {
      let event = events.get(selection.eventId);
      if (!event) {
        event = await this.getRawEvent(selection.eventId, false);
        events.set(selection.eventId, event);
      }
      if (this.eventStatus(event) !== 'scheduled')
        throw new Error(`SportyBet event unavailable or already started: ${selection.eventId}`);
      const market = event.markets.find((candidate) => candidate.id === selection.marketId &&
        (candidate.specifier ?? null) === (selection.specifier ?? null));
      if (!market || market.status > 1 || market.banned)
        throw new Error(`SportyBet market suspended: ${this.describe(selection)}`);
      const outcome = market.outcomes.find((candidate) => candidate.id === selection.selectionId);
      if (!outcome || outcome.isActive !== 1 || outcome.odds <= 1)
        throw new Error(`SportyBet outcome suspended: ${this.describe(selection)}`);
    }
  }
  private normalizeEvent(event: RawEvent): SportyBetEvent {
    return {
      providerEventId: event.eventId,
      ...(event.gameId ? { displayEventId: event.gameId } : {}),
      homeTeam: event.homeTeamName, awayTeam: event.awayTeamName,
      startsAt: new Date(event.estimateStartTime), status: this.eventStatus(event),
    };
  }
  private normalizeMarkets(event: RawEvent): NormalizedMarket[] {
    const sport = this.toSport(event.sport.id);
    return event.markets.flatMap((market) => {
      const line = this.line(market.specifier);
      return market.outcomes.map((outcome) => ({
        providerMarketId: market.id, providerSelectionId: outcome.id, eventId: event.eventId,
        sport, category: market.group ?? 'Other',
        marketName: market.name ?? market.desc ?? market.id,
        selectionName: outcome.desc, odds: outcome.odds,
        ...(line !== undefined ? { line } : {}),
        ...(market.specifier ? { specifier: market.specifier } : {}),
        status: !event.banned && market.status <= 1 && !market.banned &&
          outcome.isActive === 1 && outcome.odds > 1 ? 'active' as const : 'suspended' as const,
        lastUpdated: new Date(market.lastOddsChangeTime ?? Date.now()),
      }));
    });
  }
  private extractSelections(events: RawEvent[]): BookingSelection[] {
    return events.flatMap((event) => {
      const sport = this.toSport(event.sport.id);
      return event.markets.flatMap((market) => market.outcomes
        .filter((outcome) => outcome.isActive === 1 && outcome.odds > 1 &&
          market.status <= 1 && !market.banned)
        .map((outcome) => ({
          eventId: event.eventId, marketId: market.id, selectionId: outcome.id,
          odds: outcome.odds, ...(market.specifier ? { specifier: market.specifier } : { specifier: null }),
          homeTeam: event.homeTeamName, awayTeam: event.awayTeamName,
          marketName: market.name ?? market.desc ?? market.id,
          selectionName: outcome.desc, startsAt: new Date(event.estimateStartTime),
          sport, tournament: event.sport.category?.tournament.name ?? 'Unknown',
        })));
    });
  }
  private collectEvents(data: unknown): RawEvent[] {
    const found: RawEvent[] = [];
    const visit = (value: unknown): void => {
      const parsed = eventSchema.safeParse(value);
      if (parsed.success) { found.push(parsed.data); return; }
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(data);
    return found;
  }
  private validateSelectionInput(selections: ProviderSelection[]): void {
    if (!selections.length) throw new Error('At least one SportyBet selection is required.');
    const keys = new Set<string>();
    const marketScopes = new Set<string>();
    for (const selection of selections) {
      if (!/^sr:match:\d+$/.test(selection.eventId)) throw new Error('Invalid SportyBet event ID.');
      const key = this.describe(selection);
      if (keys.has(key)) throw new Error(`Duplicate SportyBet selection: ${key}`);
      keys.add(key);
      const scope = [selection.eventId, selection.marketId, selection.specifier ?? ''].join('|');
      if (marketScopes.has(scope)) throw new Error(`Incompatible SportyBet selections from one market: ${scope}`);
      marketScopes.add(scope);
    }
  }
  private toTuple(selection: ProviderSelection) {
    return { eventId: selection.eventId, marketId: selection.marketId,
      outcomeId: selection.selectionId, specifier: selection.specifier ?? null };
  }
  private sameTuple(left: ProviderSelection, right: ProviderSelection): boolean {
    return left.eventId === right.eventId && left.marketId === right.marketId &&
      left.selectionId === right.selectionId && (left.specifier ?? null) === (right.specifier ?? null);
  }
  private describe(selection: ProviderSelection): string {
    return [selection.eventId, selection.marketId, selection.selectionId, selection.specifier ?? ''].join('|');
  }
  private combinedOdds(selections: ProviderSelection[]): number {
    return Math.round(selections.reduce((total, selection) => total * selection.odds, 1) * 100) / 100;
  }
  private line(specifier?: string | null): number | undefined {
    if (!specifier) return undefined;
    const match = /(?:total|hcp|line)=(-?\d+(?:\.\d+)?)/i.exec(specifier);
    return match?.[1] === undefined ? undefined : Number(match[1]);
  }
  private eventStatus(event: RawEvent): SportyBetEvent['status'] {
    if (event.banned || event.status >= 3) return 'cancelled';
    if (/finished|ended/i.test(event.matchStatus ?? '')) return 'finished';
    if (event.status === 1 || /live|period|quarter|half/i.test(event.matchStatus ?? '')) return 'live';
    return 'scheduled';
  }
  private toSport(id: string): Sport {
    if (id === sportIds.football) return 'football';
    if (id === sportIds.basketball) return 'basketball';
    if (id === sportIds.tennis) return 'tennis';
    if (id === sportIds.handball) return 'handball';
    throw new Error(`Unsupported SportyBet sport: ${id}`);
  }
  private assertBusinessSuccess(response: { bizCode: number; message?: string | undefined }): void {
    if (response.bizCode !== 10_000)
      throw new Error(`SportyBet rejected the request: ${response.message ?? response.bizCode}`);
  }
  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, value });
    return value;
  }
  private async request(method: 'GET' | 'POST', path: string,
    query?: Record<string, string>, body?: unknown, retry = method === 'GET'): Promise<unknown> {
    const url = new URL(`/api/${this.region}${path}`, this.baseUrl);
    if (query) Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    const attempts = retry ? this.maxRetries + 1 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.runLimited(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            const response = await this.fetchImpl(url, {
              method, headers: this.headers(method),
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              signal: controller.signal,
            });
            if (!response.ok) throw new SportyBetHttpError(`SportyBet HTTP ${response.status}`, response.status);
            return (await response.json()) as unknown;
          } finally { clearTimeout(timeout); }
        });
      } catch (error) {
        lastError = error;
        const status = error instanceof SportyBetHttpError ? error.status : undefined;
        const retryable = status === 429 || (status !== undefined && status >= 500) || this.isAbort(error);
        if (!retryable || attempt + 1 >= attempts) throw error;
        await this.sleep(250 * 2 ** attempt);
      }
    }
    throw lastError;
  }
  private headers(method: 'GET' | 'POST'): Record<string, string> {
    return {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'Current-Country': this.region.toUpperCase(), Origin: this.baseUrl,
      Referer: `${this.baseUrl}/${this.region}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin',
      ...(method === 'POST' ? { OperId: '2' } : {}),
    };
  }
  private isAbort(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }
  private async runLimited<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      const wait = Math.max(0, this.lastStartedAt + this.minIntervalMs - Date.now());
      if (wait) await this.sleep(wait);
      this.lastStartedAt = Date.now();
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}
export const SPORTYBET_SPORT_IDS = { ...sportIds };
export const SPORTYBET_PRIMARY_MARKET_IDS = { ...primaryMarketIds };
