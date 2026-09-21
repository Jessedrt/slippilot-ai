import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WebResearchProvider } from '../you/provider.js';
import type { YouSearchItem } from '../you/types.js';

const newsSchema = z.object({
  sport: z.enum(['all', 'football', 'basketball', 'tennis', 'handball']).default('all'),
}).strict();

const topics = {
  all: 'latest football basketball tennis handball sports news today official injury team news',
  football: 'latest football soccer team news injuries fixtures official sports news today',
  basketball: 'latest basketball NBA EuroLeague injuries team news today',
  tennis: 'latest ATP WTA tennis news injury tournament today',
  handball: 'latest handball EHF IHF team tournament news today',
} as const;

export interface SportsNewsItem {
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function description(item: YouSearchItem): string {
  const text = item.description || item.snippets[0] || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Display publisher-supplied titles/excerpts only; never invent headlines or article text. */
export function normalizeSportsNews(items: YouSearchItem[], now = new Date()): SportsNewsItem[] {
  const seen = new Set<string>();
  const output: SportsNewsItem[] = [];
  for (const item of items) {
    const url = safeHttpsUrl(item.url);
    const title = item.title?.replace(/\s+/g, ' ').trim();
    if (!url || !title || title === 'Untitled') continue;
    const parsed = new URL(url);
    const identity = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const published = item.page_age ? Date.parse(item.page_age) : Number.NaN;
    const publishedAt = Number.isFinite(published) && published <= now.getTime() + 86_400_000 &&
      published >= now.getTime() - 30 * 86_400_000 ? new Date(published).toISOString() : null;
    output.push({
      title: title.slice(0, 180), url,
      publisher: parsed.hostname.replace(/^www\./i, '').slice(0, 100),
      snippet: description(item), publishedAt,
      thumbnailUrl: safeHttpsUrl((item as YouSearchItem & { thumbnail_url?: string }).thumbnail_url),
    });
    if (output.length >= 12) break;
  }
  return output;
}

/** Inherits the verified Telegram init-data preHandler installed by registerMiniAppRoutes. */
export function registerNewsRoutes(
  app: FastifyInstance,
  provider: Pick<WebResearchProvider, 'search'>,
  enabled: boolean,
): void {
  const cache = new Map<string, { expires: number; articles: SportsNewsItem[]; fetchedAt: string }>();
  const inflight = new Map<string, Promise<{ articles: SportsNewsItem[]; fetchedAt: string }>>();
  app.post('/api/miniapp/news', async (request, reply) => {
    const parsed = newsSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest('Select a supported sport category.');
    const { sport } = parsed.data;
    if (!enabled) return reply.serviceUnavailable('Sports news requires configured You.com Search access.');
    const now = Date.now();
    const cached = cache.get(sport);
    if (cached && cached.expires > now) return {
      articles: cached.articles, sport, fetchedAt: cached.fetchedAt,
      source: 'You.com Search · linked original publishers',
      disclaimer: 'Article dates and headlines are publisher-supplied. News is not a betting recommendation.',
    };
    let ongoing = inflight.get(sport);
    if (!ongoing) {
      ongoing = (async () => {
        const results = await provider.search(topics[sport]);
        // The provider classifies bona fide news into results.news. Do not relabel web pages as news.
        const articles = normalizeSportsNews(results.results.news);
        const fetchedAt = new Date().toISOString();
        cache.set(sport, { articles, fetchedAt, expires: Date.now() + 15 * 60_000 });
        return { articles, fetchedAt };
      })();
      inflight.set(sport, ongoing);
      void ongoing.finally(() => { if (inflight.get(sport) === ongoing) inflight.delete(sport); }).catch(() => undefined);
    }
    try {
      const result = await ongoing;
      return { ...result, sport, source: 'You.com Search · linked original publishers',
        disclaimer: 'Article dates and headlines are publisher-supplied. News is not a betting recommendation.' };
    } catch {
      if (cached) return { articles: cached.articles, sport, fetchedAt: cached.fetchedAt,
        source: 'You.com Search · linked original publishers', stale: true,
        disclaimer: 'News refresh failed; showing older sourced articles. Check publishers for updates.' };
      return reply.serviceUnavailable('News could not be retrieved. Please refresh later.');
    }
  });
}
