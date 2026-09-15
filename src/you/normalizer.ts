import type { ResearchSource, SportsResearchResult, YouSearchItem } from './types.js';

const trustedSportsDomains = [
  'fifa.com', 'uefa.com', 'premierleague.com', 'nba.com', 'wnba.com', 'ncaa.com',
  'espn.com', 'bbc.com', 'bbc.co.uk', 'skysports.com', 'reuters.com', 'apnews.com',
];
const lowQualityTerms = /betting|prediction|tips?|picks?|odds|casino|gambling/i;

const canonicalUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.hostname = url.hostname.replace(/^www\./, '');
  return url.toString().replace(/\/$/, '');
};

const fingerprint = (item: YouSearchItem): string =>
  (item.snippets[0] ?? item.description ?? item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 160);

export function sourceQuality(item: YouSearchItem): number {
  const host = new URL(item.url).hostname.replace(/^www\./, '');
  if (trustedSportsDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 1;
  if (/\.(gov|edu)$/.test(host) || /official|league|club|team/i.test(host + item.title)) return 0.9;
  if (lowQualityTerms.test(host + item.title)) return 0.2;
  return 0.6;
}

export function normalizeSources(items: YouSearchItem[], maximum = 8): ResearchSource[] {
  const seenUrls = new Set<string>();
  const seenText = new Set<string>();
  return items
    .map((item) => ({ item, urlKey: canonicalUrl(item.url), textKey: fingerprint(item), score: sourceQuality(item) }))
    .sort((left, right) => right.score - left.score)
    .filter(({ urlKey, textKey }) => {
      if (seenUrls.has(urlKey) || (textKey.length > 20 && seenText.has(textKey))) return false;
      seenUrls.add(urlKey);
      seenText.add(textKey);
      return true;
    })
    .slice(0, maximum)
    .map(({ item, score }) => {
      const snippet = item.snippets[0] ?? item.description;
      return {
        title: item.title,
        url: item.url,
        publisher: new URL(item.url).hostname.replace(/^www\./, ''),
        ...(item.page_age && !Number.isNaN(Date.parse(item.page_age)) ? { publishedAt: new Date(item.page_age) } : {}),
        ...(snippet ? { snippet } : {}),
        quality: score >= 0.85 ? 'high' as const : score >= 0.5 ? 'medium' as const : 'low' as const,
        qualityScore: score,
      };
    });
}

export function detectSourceConflict(sources: ResearchSource[]): boolean {
  const text = sources.map((source) => source.snippet ?? '').join(' | ').toLowerCase();
  const unavailable = /ruled out|will miss|unavailable|suspended|injured/.test(text);
  const available = /fit to play|available|cleared|returns? to (?:the )?(?:squad|lineup|team)/.test(text);
  return unavailable && available;
}

export function normalizeSportsResearch(
  summary: string,
  items: YouSearchItem[],
  maximum = 8,
  searchedAt = new Date(),
): SportsResearchResult {
  const sources = normalizeSources(items, maximum);
  const conflicting = detectSourceConflict(sources);
  const freshest = sources.reduce<Date | undefined>((latest, source) =>
    source.publishedAt && (!latest || source.publishedAt > latest) ? source.publishedAt : latest, undefined);
  const ageHours = freshest ? (searchedAt.getTime() - freshest.getTime()) / 3_600_000 : Infinity;
  const averageQuality = sources.length
    ? sources.reduce((sum, source) => sum + source.qualityScore, 0) / sources.length
    : 0;
  const confidence = Math.round(Math.max(0, Math.min(100, averageQuality * 85 - (conflicting ? 25 : 0))));
  return {
    summary: conflicting ? `${summary}\n\nInjury or availability reporting conflicts across sources.` : summary,
    sources,
    freshness: ageHours <= 6 ? 'breaking' : ageHours <= 72 ? 'recent' : 'unknown',
    confidence,
    searchedAt,
    conflicting,
    status: 'available',
  };
}
