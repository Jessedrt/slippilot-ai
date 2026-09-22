import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { CacheService } from '../services/cache.js';
import {
  youAnswerResponseSchema,
  youContentsResponseSchema,
  youResearchResponseSchema,
  youSearchResponseSchema,
  type YouAnswerResponse,
  type YouContent,
  type YouResearchResponse,
  type YouSearchResponse,
} from './types.js';

export interface YouClientOptions {
  apiKey: string;
  apiKeys?: string[];
  timeoutMs?: number;
  maxResults?: number;
  cacheTtlMs?: number;
  cache?: Pick<CacheService, 'get' | 'set'>;
  logger?: Pick<Logger, 'debug' | 'warn'>;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class YouApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'YouApiError';
  }
}

const structuredResearchResponseSchema = z.object({
  output: z.object({
    content: z.unknown(),
    content_type: z.string().optional(),
    sources: z.array(z.unknown()).default([]),
  }),
});

export type StructuredResearchResponse = z.infer<typeof structuredResearchResponseSchema>;

export class YouClient {
  private readonly timeoutMs: number;
  private readonly maxResults: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly apiKeys: string[];
  private keyIndex = 0;
  private active = 0;
  private lastStartedAt = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: YouClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResults = options.maxResults ?? 8;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.apiKeys = [...new Set([options.apiKey, ...(options.apiKeys ?? [])].filter(Boolean))];
  }

  search(query: string): Promise<YouSearchResponse> {
    return this.cached(
      'search',
      { query, count: this.maxResults, freshness: 'week', safesearch: 'moderate' },
      (value) => youSearchResponseSchema.parse(value),
      'https://ydc-index.io/v1/search',
    );
  }

  answer(query: string): Promise<YouAnswerResponse> {
    return this.cached(
      'answer',
      { query, freshness: 'week', safesearch: 'moderate' },
      (value) => youAnswerResponseSchema.parse(value),
      'https://api.you.com/v1/answer',
    );
  }

  research(query: string): Promise<YouResearchResponse> {
    return this.cached(
      'research',
      { input: query, research_effort: 'lite' },
      (value) => youResearchResponseSchema.parse(value),
      'https://api.you.com/v1/research',
    );
  }

  /** Structured output requires standard (or higher) Research effort; lite returns HTTP 422. */
  structuredResearch(
    input: string,
    outputSchema: Record<string, unknown>,
  ): Promise<StructuredResearchResponse> {
    if (!input.trim() || input.length > 40_000) {
      throw new Error('You.com Research input must contain 1–40,000 characters.');
    }
    return this.cached(
      'structured-research',
      { input, research_effort: 'standard', output_schema: outputSchema },
      (value) => structuredResearchResponseSchema.parse(value),
      'https://api.you.com/v1/research',
    );
  }

  getContents(urls: string[]): Promise<YouContent[]> {
    if (urls.length === 0 || urls.length > 10)
      throw new Error('You.com Contents requires 1–10 URLs.');
    urls.forEach((url) => new URL(url));
    return this.cached(
      'contents',
      {
        urls,
        formats: ['markdown', 'metadata'],
        crawl_timeout: Math.min(60, Math.max(1, Math.ceil(this.timeoutMs / 1000))),
      },
      (value) => youContentsResponseSchema.parse(value),
      'https://ydc-index.io/v1/contents',
    );
  }

  private async cached<T>(
    operation: string,
    body: unknown,
    parse: (value: unknown) => T,
    url: string,
  ): Promise<T> {
    const cacheKey = `slippilot:you:${operation}:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
    try {
      const hit = await this.options.cache?.get<T>(cacheKey);
      if (hit) return hit;
    } catch (error) {
      this.options.logger?.warn(
        { operation, errorType: error instanceof Error ? error.name : 'UnknownError' },
        'AUREX optional You.com cache read unavailable; continuing with live research',
      );
    }
    const result = parse(await this.request(url, body));
    try {
      await this.options.cache?.set(
        cacheKey,
        result,
        Math.max(1, Math.ceil(this.cacheTtlMs / 1000)),
      );
    } catch (error) {
      this.options.logger?.warn(
        { operation, errorType: error instanceof Error ? error.name : 'UnknownError' },
        'AUREX optional You.com cache write unavailable',
      );
    }
    return result;
  }

  private async request(url: string, body: unknown): Promise<unknown> {
    let lastError: unknown;
    const maxAttempts = Math.max(3, this.apiKeys.length);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.runLimited(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            this.options.logger?.debug({ provider: 'You.com', url, attempt }, 'You.com request');
            const response = await this.fetchImpl(url, {
              method: 'POST',
              headers: {
                'X-API-Key': this.apiKeys[this.keyIndex]!,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            if (!response.ok) {
              const error = new YouApiError(`You.com HTTP ${response.status}`, response.status);
              Object.assign(error, { retryAfter: response.headers.get('retry-after') });
              throw error;
            }
            return (await response.json()) as unknown;
          } finally {
            clearTimeout(timeout);
          }
        });
      } catch (error) {
        lastError = error;
        const status = error instanceof YouApiError ? error.status : undefined;
        const canRotate =
          this.apiKeys.length > 1 && (status === 401 || status === 403 || status === 429);
        const transient =
          status === 429 ||
          (status !== undefined && status >= 500) ||
          (error instanceof Error && error.name === 'AbortError');
        const exhausted = attempt === maxAttempts - 1 || (!canRotate && attempt === 2);
        if ((!transient && !canRotate) || exhausted) throw error;
        if (canRotate) this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
        const retryAfter =
          error instanceof YouApiError
            ? Number((error as YouApiError & { retryAfter?: string }).retryAfter)
            : 0;
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt,
        );
      }
    }
    throw lastError;
  }

  private async runLimited<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 2) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      const delay = Math.max(0, this.lastStartedAt + 200 - Date.now());
      if (delay) await this.sleep(delay);
      this.lastStartedAt = Date.now();
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}
