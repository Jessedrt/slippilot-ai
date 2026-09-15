import type { NormalizedMarket, Sport } from '../types/domain.js';
import type { ProviderSelection, SportyBetEvent, SportyBetProvider } from './contracts.js';

export interface SportyBetWebProviderConfig {
  apiBaseUrl: string;
  region: string;
  timeoutMs: number;
  minIntervalMs: number;
  maxConcurrency: number;
  maxRetries: number;
  cacheTtlMs: number;
  timelineHours: number;
  pageSize: number;
  maxPages: number;
  footballMarketIds: string[];
  basketballMarketIds: string[];
}

type RawOutcome = {
  id?: string | number;
  desc?: string;
  odds?: string | number;
  isActive?: number | boolean;
};

type RawMarket = {
  id?: string | number;
  desc?: string;
  name?: string;
  title?: string;
  specifier?: string;
  status?: number | string;
  group?: string;
  outcomes?: RawOutcome[];
};

type RawEvent = {
  eventId?: string;
  gameId?: string | number;
  estimateStartTime?: number;
  matchStatus?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  markets?: RawMarket[];
};

type RawTournament = {
  name?: string;
  categoryName?: string;
  events?: RawEvent[];
};

type RawUpcomingResponse = {
  bizCode?: number | string;
  message?: string;
  data?: { tournaments?: RawTournament[] };
};

type RawBookingResponse = {
  bizCode?: number | string;
  message?: string;
  data?: {
    shareCode?: string;
    shareURL?: string;
    deadline?: number;
    outcomes?: Array<{
      eventId?: string;
      markets?: RawMarket[];
    }>;
    unavailableOutcomes?: unknown[];
  };
};

type EventRecord = { sport: Sport; event: RawEvent };
type CacheEntry = { at: number; records: EventRecord[] };

const PRIMARY_MARKETS: Record<Sport, string[]> = {
  football: ['1', '18', '10', '29', '11', '14'],
  basketball: ['219', '223', '225'],
};

const SPORT_IDS: Record<Sport, string> = {
  football: 'sr:sport:1',
  basketball: 'sr:sport:2',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const normalizedTeam = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|bc|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

export class SportyBetWebError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'SportyBetWebError';
  }
}

export class SportyBetWebProvider implements SportyBetProvider {
  readonly name = 'SportyBet' as const;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly eventIndex = new Map<string, EventRecord>();
  private lastRequestAt = 0;
  private inFlight = 0;

  constructor(private readonly config: SportyBetWebProviderConfig) {}

  private get apiBase(): string {
    return `${this.config.apiBaseUrl.replace(/\/$/, '')}/api/${this.config.region.toLowerCase()}`;
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Current-Country': this.config.region.toUpperCase(),
    };
  }

  private async acquireSlot(): Promise<void> {
    for (;;) {
      const wait = this.lastRequestAt + this.config.minIntervalMs - Date.now();
      if (this.inFlight < this.config.maxConcurrency && wait <= 0) {
        this.inFlight += 1;
        this.lastRequestAt = Date.now();
        return;
      }
      await sleep(Math.max(wait, 10));
    }
  }

  private releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  private async backoff(attempt: number, status = 0): Promise<void> {
    const base = 350 * 2 ** Math.max(0, attempt - 1);
    const extra = status === 429 ? base : 0;
    await sleep(base + extra + Math.floor(Math.random() * 100));
  }

  private errorForStatus(status: number, message?: string): SportyBetWebError {
    if (status === 400) return new SportyBetWebError('BAD_REQUEST', message ?? 'SportyBet rejected the request.');
    if (status === 401)
      return new SportyBetWebError('UNAUTHORIZED', message ?? 'SportyBet now requires authentication.');
    if (status === 403)
      return new SportyBetWebError(
        'FORBIDDEN',
        message ?? 'SportyBet refused this server-side request. The deployment network may be blocked.',
      );
    if (status === 404)
      return new SportyBetWebError('NOT_FOUND', message ?? 'SportyBet endpoint or resource was not found.');
    if (status === 429)
      return new SportyBetWebError('RATE_LIMITED', message ?? 'SportyBet rate limited the request.', true);
    if (status >= 500)
      return new SportyBetWebError('UPSTREAM', message ?? `SportyBet returned HTTP ${status}.`, true);
    return new SportyBetWebError('HTTP_ERROR', message ?? `SportyBet returned HTTP ${status}.`);
  }

  private messageFrom(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.error === 'string') return record.error;
    return undefined;
  }

  private assertBusinessSuccess(body: unknown): void {
    if (!body || typeof body !== 'object') return;
    const record = body as Record<string, unknown>;
    if (record.bizCode === undefined || record.bizCode === null) return;
    const code = Number(record.bizCode);
    if (Number.isFinite(code) && code !== 10000) {
      throw new SportyBetWebError(
        'UPSTREAM_REJECTED',
        this.messageFrom(body) ?? `SportyBet rejected the request with bizCode ${String(record.bizCode)}.`,
      );
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? 'GET').toUpperCase();
    const maxAttempts = method === 'GET' ? this.config.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.acquireSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(`${this.apiBase}${path}`, {
          ...init,
          headers: this.headers(),
          signal: controller.signal,
        });
        const text = await response.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          throw new SportyBetWebError(
            'MALFORMED_RESPONSE',
            `SportyBet returned a non-JSON response (HTTP ${response.status}).`,
            true,
          );
        }

        if (!response.ok) {
          const error = this.errorForStatus(response.status, this.messageFrom(body));
          if (error.retryable && method === 'GET' && attempt < maxAttempts) {
            await this.backoff(attempt, response.status);
            continue;
          }
          throw error;
        }

        this.assertBusinessSuccess(body);
        return body as T;
      } catch (error) {
        lastError = error;
        if (error instanceof SportyBetWebError) throw error;
        const isAbort = error instanceof Error && error.name === 'AbortError';
        if (method === 'GET' && attempt < maxAttempts) {
          await this.backoff(attempt);
          continue;
        }
        throw new SportyBetWebError(
          isAbort ? 'TIMEOUT' : 'NETWORK',
          isAbort
            ? `SportyBet request timed out after ${this.config.timeoutMs}ms.`
            : `Could not reach SportyBet: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      } finally {
        clearTimeout(timer);
        this.releaseSlot();
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new SportyBetWebError('NETWORK', 'SportyBet request failed.');
  }

  private marketIdsFor(sport: Sport): string[] {
    return sport === 'football'
      ? this.config.footballMarketIds
      : this.config.basketballMarketIds;
  }

  private cacheKey(sport: Sport, marketIds: string[]): string {
    return `${sport}:${marketIds.join(',')}:${this.config.timelineHours}:${this.config.pageSize}`;
  }

  private remember(records: EventRecord[]): void {
    for (const record of records) {
      const id = String(record.event.eventId ?? '');
      if (id) this.eventIndex.set(id, record);
    }
  }

  private flatten(sport: Sport, tournaments: RawTournament[] | undefined): EventRecord[] {
    const records: EventRecord[] = [];
    for (const tournament of tournaments ?? []) {
      for (const event of tournament.events ?? []) {
        if (event.eventId) records.push({ sport, event });
      }
    }
    return records;
  }

  private async fetchCatalog(sport: Sport, marketIds: string[]): Promise<EventRecord[]> {
    const uniqueMarketIds = [...new Set(marketIds.filter(Boolean))];
    const key = this.cacheKey(sport, uniqueMarketIds);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at <= this.config.cacheTtlMs) return cached.records;

    const records: EventRecord[] = [];
    for (let page = 1; page <= this.config.maxPages; page += 1) {
      const params = new URLSearchParams({
        sportId: SPORT_IDS[sport],
        marketId: uniqueMarketIds.join(','),
        pageSize: String(this.config.pageSize),
        pageNum: String(page),
        todayGames: 'false',
        timeline: String(this.config.timelineHours),
        _t: String(Date.now()),
      });
      const raw = await this.request<RawUpcomingResponse>(
        `/factsCenter/pcUpcomingEvents?${params.toString()}`,
      );
      const pageRecords = this.flatten(sport, raw.data?.tournaments);
      records.push(...pageRecords);
      if (pageRecords.length === 0 || pageRecords.length < this.config.pageSize) break;
    }

    this.cache.set(key, { at: Date.now(), records });
    this.remember(records);
    return records;
  }

  private statusFor(event: RawEvent): SportyBetEvent['status'] {
    const value = String(event.matchStatus ?? '').toLowerCase();
    if (/cancel|postpon|abandon/.test(value)) return 'cancelled';
    if (/finish|ended|result|closed/.test(value)) return 'finished';
    if (/not start|scheduled|prematch|pre-match|upcoming/.test(value)) return 'scheduled';
    const kickoff = Number(event.estimateStartTime ?? 0);
    if (kickoff > Date.now()) return 'scheduled';
    return 'live';
  }

  private toEvent(record: EventRecord): SportyBetEvent {
    const start = Number(record.event.estimateStartTime ?? 0);
    return {
      providerEventId: String(record.event.eventId ?? ''),
      displayEventId: record.event.gameId === undefined ? undefined : String(record.event.gameId),
      homeTeam: String(record.event.homeTeamName ?? ''),
      awayTeam: String(record.event.awayTeamName ?? ''),
      startsAt: new Date(Number.isFinite(start) && start > 0 ? start : 0),
      status: this.statusFor(record.event),
    };
  }

  private categoryFor(name: string, group?: string): string {
    if (group?.trim()) return group.trim();
    const value = name.toLowerCase();
    if (value.includes('corner')) return 'Corners';
    if (value.includes('card') || value.includes('booking')) return 'Cards';
    if (value.includes('half') || value.includes('quarter')) return 'Period';
    if (value.includes('handicap')) return 'Handicap';
    if (value.includes('over/under') || value.includes('total')) return 'Totals';
    if (value.includes('gg/ng') || value.includes('both teams')) return 'BTTS';
    if (value.includes('score')) return 'Score';
    return 'Main';
  }

  private lineFrom(specifier?: string): number | undefined {
    if (!specifier) return undefined;
    const match = specifier.match(/(?:total|hcp)=(-?\d+(?:\.\d+)?)/i);
    if (!match) return undefined;
    const line = Number(match[1]);
    return Number.isFinite(line) ? line : undefined;
  }

  private normalizeMarkets(record: EventRecord): NormalizedMarket[] {
    const eventId = String(record.event.eventId ?? '');
    const normalized: NormalizedMarket[] = [];
    for (const market of record.event.markets ?? []) {
      const marketId = String(market.id ?? '');
      const marketName = String(market.desc ?? market.name ?? market.title ?? marketId);
      const marketTextStatus = typeof market.status === 'string' ? market.status.toLowerCase() : '';
      const marketSuspended = /suspend|closed|settled|inactive/.test(marketTextStatus);
      for (const outcome of market.outcomes ?? []) {
        const odds = Number(outcome.odds);
        if (!Number.isFinite(odds) || !marketId || !outcome.id) continue;
        const outcomeActive = outcome.isActive !== 0 && outcome.isActive !== false;
        normalized.push({
          providerMarketId: marketId,
          providerSelectionId: String(outcome.id),
          eventId,
          sport: record.sport,
          category: this.categoryFor(marketName, market.group),
          marketName,
          selectionName: String(outcome.desc ?? outcome.id),
          odds,
          line: this.lineFrom(market.specifier),
          specifier: market.specifier,
          status: marketSuspended || !outcomeActive ? 'suspended' : 'active',
          lastUpdated: new Date(),
        });
      }
    }
    return normalized;
  }

  async listUpcoming(sport: Sport): Promise<SportyBetEvent[]> {
    return (await this.fetchCatalog(sport, PRIMARY_MARKETS[sport])).map((record) =>
      this.toEvent(record),
    );
  }

  async findEvents(homeTeam: string, awayTeam: string, sport?: Sport): Promise<SportyBetEvent[]> {
    const sports: Sport[] = sport ? [sport] : ['football', 'basketball'];
    const home = normalizedTeam(homeTeam);
    const away = normalizedTeam(awayTeam);
    const matches: SportyBetEvent[] = [];

    for (const currentSport of sports) {
      const records = await this.fetchCatalog(currentSport, PRIMARY_MARKETS[currentSport]);
      for (const record of records) {
        const recordHome = normalizedTeam(String(record.event.homeTeamName ?? ''));
        const recordAway = normalizedTeam(String(record.event.awayTeamName ?? ''));
        const homeMatch = recordHome === home || recordHome.includes(home) || home.includes(recordHome);
        const awayMatch = recordAway === away || recordAway.includes(away) || away.includes(recordAway);
        if (homeMatch && awayMatch) matches.push(this.toEvent(record));
      }
    }
    return matches;
  }

  async getEvent(eventId: string): Promise<SportyBetEvent | null> {
    const cached = this.eventIndex.get(eventId);
    if (cached) return this.toEvent(cached);
    for (const sport of ['football', 'basketball'] as const) {
      const record = (await this.fetchCatalog(sport, PRIMARY_MARKETS[sport])).find(
        (item) => item.event.eventId === eventId,
      );
      if (record) return this.toEvent(record);
    }
    return null;
  }

  async getMarkets(eventId: string): Promise<NormalizedMarket[]> {
    const cached = this.eventIndex.get(eventId);
    const sports: Sport[] = cached ? [cached.sport] : ['football', 'basketball'];
    for (const sport of sports) {
      const record = (await this.fetchCatalog(sport, this.marketIdsFor(sport))).find(
        (item) => item.event.eventId === eventId,
      );
      if (record) return this.normalizeMarkets(record);
    }
    return [];
  }

  async createBookingCode(selections: ProviderSelection[]): Promise<string> {
    if (selections.length === 0) throw new SportyBetWebError('EMPTY_SELECTION', 'No selections provided.');
    if (selections.length > 100)
      throw new SportyBetWebError('TOO_MANY_SELECTIONS', 'A booking code cannot contain more than 100 selections.');

    const validated: ProviderSelection[] = [];
    const seen = new Set<string>();
    for (const selection of selections) {
      const markets = await this.getMarkets(selection.eventId);
      const current = markets.find(
        (market) =>
          market.providerMarketId === selection.marketId &&
          market.providerSelectionId === selection.selectionId &&
          market.specifier === selection.specifier &&
          market.status === 'active',
      );
      if (!current) {
        throw new SportyBetWebError(
          'SELECTION_UNAVAILABLE',
          `Selection ${selection.eventId}/${selection.marketId}/${selection.selectionId} is unavailable or suspended.`,
        );
      }
      const key = `${selection.eventId}|${selection.marketId}|${current.specifier ?? ''}|${selection.selectionId}`;
      if (seen.has(key)) throw new SportyBetWebError('DUPLICATE_SELECTION', 'Duplicate SportyBet selection detected.');
      seen.add(key);
      validated.push({
        eventId: selection.eventId,
        marketId: selection.marketId,
        selectionId: selection.selectionId,
        odds: current.odds,
        specifier: current.specifier,
      });
    }

    const raw = await this.request<RawBookingResponse>('/orders/share', {
      method: 'POST',
      body: JSON.stringify({
        selections: validated.map((selection) => ({
          eventId: selection.eventId,
          marketId: selection.marketId,
          specifier: selection.specifier ?? null,
          outcomeId: selection.selectionId,
        })),
      }),
    });
    const code = raw.data?.shareCode?.trim();
    if (!code)
      throw new SportyBetWebError(
        'NO_BOOKING_CODE',
        'SportyBet accepted the request but did not return a booking code.',
      );
    return code;
  }

  async resolveBookingCode(code: string): Promise<ProviderSelection[]> {
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(clean))
      throw new SportyBetWebError('INVALID_BOOKING_CODE', 'Invalid SportyBet booking code format.');
    const raw = await this.request<RawBookingResponse>(
      `/orders/share/${encodeURIComponent(clean)}`,
    );
    if (!raw.data?.shareCode)
      throw new SportyBetWebError('BOOKING_NOT_FOUND', `SportyBet booking code ${clean} was not found or expired.`);

    const selections: ProviderSelection[] = [];
    for (const leg of raw.data.outcomes ?? []) {
      const eventId = String(leg.eventId ?? '');
      for (const market of leg.markets ?? []) {
        const marketId = String(market.id ?? '');
        for (const outcome of market.outcomes ?? []) {
          const odds = Number(outcome.odds);
          if (!eventId || !marketId || !outcome.id || !Number.isFinite(odds)) continue;
          selections.push({
            eventId,
            marketId,
            selectionId: String(outcome.id),
            odds,
            specifier: market.specifier,
          });
        }
      }
    }
    return selections;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.fetchCatalog('football', PRIMARY_MARKETS.football);
      return { ok: true, detail: 'SportyBet public web API reachable' };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'SportyBet public web API unavailable',
      };
    }
  }
}
