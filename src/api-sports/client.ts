import { z } from 'zod';
import type { CacheService } from '../services/cache.js';

export type ApiSportsProduct = 'football' | 'basketball';

// API-Sports returns [] for endpoints without query parameters (including /status).
const envelopeSchema = z
  .object({
    get: z.string(),
    parameters: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    results: z.number().int().nonnegative(),
    // API-Football includes paging. API-Basketball documents and returns
    // non-paginated envelopes for endpoints such as /games, so product-aware
    // validation below normalizes only that product to a single page.
    paging: z
      .object({ current: z.number().int().positive(), total: z.number().int().positive() })
      .optional(),
    response: z.unknown(),
  })
  .passthrough();

const statusSchema = z
  .object({
    account: z.object({}).passthrough().optional(),
    subscription: z
      .object({
        active: z.union([z.number(), z.boolean()]),
        plan: z.string().min(1).optional(),
        end: z.string().min(1).nullable().optional(),
      })
      .passthrough(),
    requests: z
      .object({
        current: z.number().int().nonnegative(),
        limit_day: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

export type ApiSportsErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'missing_entitlement'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'provider_error'
  | 'invalid_response'
  | 'timeout';

export class ApiSportsError extends Error {
  readonly statusCode = 424;
  constructor(
    readonly code: ApiSportsErrorCode,
    message: string,
    readonly retryable = false,
    /** Redacted provider detail for backend diagnostics only. Never return this to clients. */
    readonly providerDetail?: string,
  ) {
    super(message);
    this.name = 'ApiSportsError';
  }
}

export interface ApiSportsClientOptions {
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  cache?: Pick<CacheService, 'get' | 'set'>;
  footballBaseUrl?: string;
  basketballBaseUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  onRequest?: (event: ApiSportsRequestEvent) => void;
}

export interface ApiSportsRequestEvent {
  product: ApiSportsProduct;
  path: string;
  source: 'cache' | 'live';
  outcome: 'success' | 'failure';
  durationMs: number;
  errorCode?: ApiSportsErrorCode;
  /** Redacted provider detail for privacy-conscious server logs only. */
  providerDetail?: string;
}

export interface ApiSportsResult<T> {
  data: T;
  retrievedAt: Date;
  paging: { current: number; total: number };
  source: 'cache' | 'live' | 'mixed';
  remainingDaily?: number;
  remainingMinute?: number;
}

const errorText = (errors: unknown[] | Record<string, unknown>): string =>
  (Array.isArray(errors) ? errors : Object.values(errors))
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('; ')
    .slice(0, 500);

const hasErrors = (errors: unknown[] | Record<string, unknown>): boolean =>
  Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0;

export class ApiSportsClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly bases: Record<ApiSportsProduct, string>;
  private readonly inFlight = new Map<string, Promise<ApiSportsResult<unknown>>>();

  constructor(private readonly options: ApiSportsClientOptions) {
    if (!options.apiKey.trim())
      throw new ApiSportsError('not_configured', 'API-Sports is not configured.');
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.bases = {
      football: (options.footballBaseUrl ?? 'https://v3.football.api-sports.io').replace(/\/$/, ''),
      basketball: (options.basketballBaseUrl ?? 'https://v1.basketball.api-sports.io').replace(
        /\/$/,
        '',
      ),
    };
  }

  async request<T>(
    product: ApiSportsProduct,
    path: string,
    parameters: Record<string, string | number>,
    responseSchema: z.ZodType<T>,
    cacheTtlSeconds = 0,
    signal?: AbortSignal,
  ): Promise<ApiSportsResult<T>> {
    const startedAt = Date.now();
    const query = new URLSearchParams(
      Object.entries(parameters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, String(value)]),
    );
    const dedupeKey = `${product}:${path}:${query.toString()}`;
    const existing = this.inFlight.get(dedupeKey);
    if (existing) return existing as Promise<ApiSportsResult<T>>;
    const pending = this.executeRequest(
      product,
      path,
      parameters,
      responseSchema,
      cacheTtlSeconds,
      signal,
    );
    this.inFlight.set(dedupeKey, pending);
    try {
      const result = await pending;
      this.options.onRequest?.({
        product,
        path,
        source: result.source === 'cache' ? 'cache' : 'live',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.options.onRequest?.({
        product,
        path,
        source: 'live',
        outcome: 'failure',
        durationMs: Date.now() - startedAt,
        ...(error instanceof ApiSportsError ? { errorCode: error.code } : {}),
        ...(error instanceof ApiSportsError && error.providerDetail
          ? { providerDetail: error.providerDetail }
          : {}),
      });
      throw error;
    } finally {
      if (this.inFlight.get(dedupeKey) === pending) this.inFlight.delete(dedupeKey);
    }
  }

  private async executeRequest<T>(
    product: ApiSportsProduct,
    path: string,
    parameters: Record<string, string | number>,
    responseSchema: z.ZodType<T>,
    cacheTtlSeconds: number,
    signal?: AbortSignal,
  ): Promise<ApiSportsResult<T>> {
    const query = new URLSearchParams(
      Object.entries(parameters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, String(value)]),
    );
    const safeKey = `api-sports:${product}:${path}:${query.toString()}`;
    if (cacheTtlSeconds > 0 && this.options.cache) {
      try {
        const cached = await this.options.cache.get<{
          data: T;
          retrievedAt: string;
          paging: { current: number; total: number };
        }>(safeKey);
        const cachedAt = cached ? new Date(cached.retrievedAt) : null;
        const age = cachedAt ? Date.now() - cachedAt.getTime() : Number.POSITIVE_INFINITY;
        if (
          cached &&
          cachedAt &&
          Number.isFinite(cachedAt.getTime()) &&
          age >= -60_000 &&
          age <= cacheTtlSeconds * 1000 &&
          Number.isSafeInteger(cached.paging?.current) &&
          Number.isSafeInteger(cached.paging?.total)
        )
          return {
            data: responseSchema.parse(cached.data),
            retrievedAt: cachedAt,
            paging: cached.paging,
            source: 'cache',
          };
      } catch {
        // Statistics remain mandatory; only the optional cache may fail open.
      }
    }
    const url = `${this.bases[product]}${path}?${query.toString()}`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          headers: { 'x-apisports-key': this.options.apiKey, accept: 'application/json' },
          signal: controller.signal,
        });
        const remainingDaily = this.numberHeader(
          response.headers,
          'x-ratelimit-requests-remaining',
        );
        const remainingMinute = this.numberHeader(response.headers, 'x-ratelimit-remaining');
        if (response.status === 401)
          throw new ApiSportsError(
            'unauthorized',
            'API-Sports rejected the configured credential.',
          );
        if (response.status === 403)
          throw new ApiSportsError(
            'missing_entitlement',
            `API-Sports ${product} access is not included in the configured subscription.`,
          );
        if (response.status === 429) {
          const exhausted = remainingDaily === 0;
          if (!exhausted && attempt < this.maxRetries) {
            const retryAfter = Number(response.headers.get('retry-after') ?? '1');
            await (
              this.options.sleep ??
              ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
            )(
              Math.min(
                2_000,
                Math.max(100, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1_000),
              ),
            );
            continue;
          }
          throw new ApiSportsError(
            exhausted ? 'quota_exhausted' : 'rate_limited',
            exhausted
              ? `API-Sports ${product} daily quota is exhausted.`
              : `API-Sports ${product} rate limit was reached.`,
            false,
          );
        }
        if (!response.ok) {
          if (response.status >= 500 && attempt < this.maxRetries) {
            await this.pauseRetry(attempt);
            continue;
          }
          throw new ApiSportsError(
            'provider_error',
            `API-Sports ${product} returned HTTP ${response.status}.`,
            response.status >= 500,
          );
        }
        let raw: unknown;
        try {
          raw = await response.json();
        } catch {
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} returned invalid JSON.`,
          );
        }
        const envelope = envelopeSchema.safeParse(raw);
        if (!envelope.success)
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} returned a malformed response.`,
            false,
            this.validationSummary(envelope.error),
          );
        if (hasErrors(envelope.data.errors)) {
          const detail = this.redact(errorText(envelope.data.errors));
          const normalized = detail.toLowerCase();
          const code: ApiSportsErrorCode = /api.?key|token|authenticat|credential/.test(normalized)
            ? 'unauthorized'
            : /subscription|plan|access|permission|product/.test(normalized)
              ? 'missing_entitlement'
              : /rate.?limit|too many|per minute/.test(normalized)
                ? 'rate_limited'
                : /daily|quota|request limit/.test(normalized)
                  ? 'quota_exhausted'
                  : 'provider_error';
          // Provider error detail is not sent to the Mini App: it may contain account data.
          throw new ApiSportsError(
            code,
            `API-Sports ${product} rejected the request (${code}).`,
            false,
            detail,
          );
        }
        const paging = envelope.data.paging;
        if (!paging && product !== 'basketball')
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} returned a malformed response.`,
            false,
            'paging:missing',
          );
        const parsed = responseSchema.safeParse(envelope.data.response);
        if (!parsed.success)
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} response failed strict validation.`,
            false,
            this.validationSummary(parsed.error),
          );
        if (Array.isArray(parsed.data) && envelope.data.results !== parsed.data.length)
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} response failed strict validation.`,
            false,
            `results_count_mismatch:declared=${envelope.data.results}:parsed=${parsed.data.length}`,
          );
        const result: ApiSportsResult<T> = {
          data: parsed.data,
          retrievedAt: new Date(),
          paging: paging ?? { current: 1, total: 1 },
          source: 'live',
          ...(remainingDaily === undefined ? {} : { remainingDaily }),
          ...(remainingMinute === undefined ? {} : { remainingMinute }),
        };
        if (cacheTtlSeconds > 0 && this.options.cache) {
          try {
            await this.options.cache.set(
              safeKey,
              {
                data: parsed.data,
                retrievedAt: result.retrievedAt.toISOString(),
                paging: result.paging,
              },
              cacheTtlSeconds,
            );
          } catch {
            // Optional cache failures never become fabricated statistics.
          }
        }
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof ApiSportsError && (!error.retryable || attempt >= this.maxRetries))
          throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt >= this.maxRetries)
            throw new ApiSportsError('timeout', `API-Sports ${product} request timed out.`, true);
        } else if (attempt >= this.maxRetries) {
          throw error instanceof ApiSportsError
            ? error
            : new ApiSportsError('provider_error', `API-Sports ${product} is unavailable.`, true);
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ApiSportsError('provider_error', 'API-Sports is unavailable.');
  }

  async requestAllPages<T>(
    product: ApiSportsProduct,
    path: string,
    parameters: Record<string, string | number>,
    itemSchema: z.ZodType<T>,
    cacheTtlSeconds = 0,
    maxPages = 10,
  ): Promise<ApiSportsResult<T[]>> {
    if ('page' in parameters) throw new Error('Pagination is managed by requestAllPages.');
    const items: T[] = [];
    let retrievedAt = new Date(0);
    let remainingDaily: number | undefined;
    let remainingMinute: number | undefined;
    let totalPages = 1;
    const sources = new Set<ApiSportsResult<T[]>['source']>();
    for (let page = 1; page <= totalPages; page += 1) {
      const result = await this.request(
        product,
        path,
        { ...parameters, page },
        z.array(itemSchema),
        cacheTtlSeconds,
      );
      if (page === 1) {
        totalPages = result.paging.total;
        if (totalPages > maxPages)
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} pagination exceeds the configured safe limit.`,
          );
      }
      if (result.paging.current !== page || result.paging.total !== totalPages)
        throw new ApiSportsError(
          'invalid_response',
          `API-Sports ${product} returned inconsistent pagination.`,
        );
      items.push(...result.data);
      sources.add(result.source);
      if (result.retrievedAt > retrievedAt) retrievedAt = result.retrievedAt;
      remainingDaily = result.remainingDaily ?? remainingDaily;
      remainingMinute = result.remainingMinute ?? remainingMinute;
    }
    return {
      data: items,
      retrievedAt,
      paging: { current: totalPages, total: totalPages },
      source: sources.size > 1 ? 'mixed' : (sources.values().next().value ?? 'live'),
      ...(remainingDaily === undefined ? {} : { remainingDaily }),
      ...(remainingMinute === undefined ? {} : { remainingMinute }),
    };
  }

  // /status reports account-level data. Call without caching and return only schema-validated data.
  // Status checks authenticate a subscription; they do not prove coverage for a specific fixture.
  async verifyEntitlement(
    product: ApiSportsProduct,
  ): Promise<ApiSportsResult<z.infer<typeof statusSchema>>> {
    return this.request(product, '/status', {}, statusSchema);
  }

  private numberHeader(headers: Headers, name: string): number | undefined {
    const value = headers.get(name);
    if (value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private redact(value: string): string {
    return value
      .replaceAll(this.options.apiKey, '[REDACTED]')
      .replace(/bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED_EMAIL]')
      .replace(
        /((?:api[-_ ]?key|token|authorization|credential)["'\s:=]+)[^\s,;}]+/gi,
        '$1[REDACTED]',
      )
      .slice(0, 240);
  }

  private validationSummary(error: z.ZodError): string {
    return error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}:${issue.code}`)
      .join(',')
      .slice(0, 240);
  }

  private pauseRetry(attempt: number): Promise<void> {
    const milliseconds = Math.min(1_000, 200 * 2 ** attempt);
    return (
      this.options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
    )(milliseconds);
  }
}
