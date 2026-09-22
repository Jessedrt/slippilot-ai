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
    paging: z.object({ current: z.number().int().positive(), total: z.number().int().positive() }),
    response: z.unknown(),
  })
  .passthrough();

const statusSchema = z
  .object({
    subscription: z
      .object({ active: z.union([z.number(), z.boolean()]) })
      .passthrough(),
    requests: z
      .object({ current: z.number().int().nonnegative(), limit_day: z.number().int().nonnegative() })
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
}

export interface ApiSportsResult<T> {
  data: T;
  retrievedAt: Date;
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
  ): Promise<ApiSportsResult<T>> {
    const query = new URLSearchParams(
      Object.entries(parameters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, String(value)]),
    );
    const safeKey = `api-sports:${product}:${path}:${query.toString()}`;
    if (cacheTtlSeconds > 0 && this.options.cache) {
      try {
        const cached = await this.options.cache.get<{ data: T; retrievedAt: string }>(safeKey);
        if (cached)
          return {
            data: responseSchema.parse(cached.data),
            retrievedAt: new Date(cached.retrievedAt),
          };
      } catch {
        // Statistics remain mandatory; only the optional cache may fail open.
      }
    }
    const url = `${this.bases[product]}${path}?${query.toString()}`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
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
          if (response.status >= 500 && attempt < this.maxRetries) continue;
          throw new ApiSportsError(
            'provider_error',
            `API-Sports ${product} returned HTTP ${response.status}.`,
            response.status >= 500,
          );
        }
        const raw: unknown = await response.json();
        const envelope = envelopeSchema.safeParse(raw);
        if (!envelope.success)
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} returned a malformed response.`,
          );
        if (hasErrors(envelope.data.errors)) {
          const detail = errorText(envelope.data.errors);
          const normalized = detail.toLowerCase();
          const code: ApiSportsErrorCode = /subscription|plan|access|permission/.test(normalized)
            ? 'missing_entitlement'
            : /limit|quota|request/.test(normalized)
              ? 'quota_exhausted'
              : 'provider_error';
          // Provider error detail is not sent to the Mini App: it may contain account data.
          throw new ApiSportsError(
            code,
            `API-Sports ${product} rejected the request (${code}).`,
          );
        }
        const parsed = responseSchema.safeParse(envelope.data.response);
        if (
          !parsed.success ||
          (Array.isArray(parsed.data) && envelope.data.results !== parsed.data.length)
        )
          throw new ApiSportsError(
            'invalid_response',
            `API-Sports ${product} response failed strict validation.`,
          );
        const result: ApiSportsResult<T> = {
          data: parsed.data,
          retrievedAt: new Date(),
          ...(remainingDaily === undefined ? {} : { remainingDaily }),
          ...(remainingMinute === undefined ? {} : { remainingMinute }),
        };
        if (cacheTtlSeconds > 0 && this.options.cache) {
          try {
            await this.options.cache.set(
              safeKey,
              { data: parsed.data, retrievedAt: result.retrievedAt.toISOString() },
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
        if (error instanceof DOMException && error.name === 'AbortError') {
          if (attempt >= this.maxRetries)
            throw new ApiSportsError('timeout', `API-Sports ${product} request timed out.`, true);
        } else if (attempt >= this.maxRetries) {
          throw error instanceof ApiSportsError
            ? error
            : new ApiSportsError('provider_error', `API-Sports ${product} is unavailable.`, true);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ApiSportsError('provider_error', 'API-Sports is unavailable.');
  }

  // /status reports account-level data. Call without caching and return only sanitized fields to clients.
  // Status checks authenticate a subscription; they do not prove coverage for a specific fixture.
  async verifyEntitlement(product: ApiSportsProduct): Promise<ApiSportsResult<z.infer<typeof statusSchema>>> {
    return this.request(product, '/status', {}, statusSchema);
  }

  private numberHeader(headers: Headers, name: string): number | undefined {
    const value = headers.get(name);
    if (value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
