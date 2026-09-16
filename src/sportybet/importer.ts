import type { ScreenshotExtraction } from '../ai/screenshot-normalizer.js';
import type {
  CandidateSelection,
  NormalizedMarket,
  RiskLevel,
  SlipDraft,
  Sport,
} from '../types/domain.js';
import type { SportyBetEvent, SportyBetProvider } from './contracts.js';
import { nameSimilarity } from './mapper.js';

export interface PickRequest {
  text: string;
  homeTeam?: string;
  awayTeam?: string;
  competition?: string;
  confidence?: number;
}

const riskLevel = (odds: number): RiskLevel =>
  odds <= 1.4 ? 'lower' : odds <= 2.1 ? 'medium' : 'higher';

const textSimilarity = (query: string, candidate: string): number => {
  const direct = nameSimilarity(query, candidate);
  const words = query.toLowerCase().match(/[a-z0-9.]+/g) ?? [];
  const normalizedCandidate = candidate.toLowerCase();
  const overlap = words.filter(
    (word) => word.length > 1 && normalizedCandidate.includes(word),
  ).length;
  return Math.max(direct, words.length ? overlap / words.length : 0);
};

function eventScore(request: PickRequest, event: SportyBetEvent): number {
  if (request.homeTeam && request.awayTeam) {
    return Math.max(
      (nameSimilarity(request.homeTeam, event.homeTeam) +
        nameSimilarity(request.awayTeam, event.awayTeam)) /
        2,
      (nameSimilarity(request.homeTeam, event.awayTeam) +
        nameSimilarity(request.awayTeam, event.homeTeam)) /
        2,
    );
  }
  return Math.max(
    nameSimilarity(request.text, event.homeTeam),
    nameSimilarity(request.text, event.awayTeam),
  );
}

function marketScore(
  request: PickRequest,
  event: SportyBetEvent,
  market: NormalizedMarket,
): number {
  const teamless = request.text
    .replace(new RegExp(event.homeTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    .replace(new RegExp(event.awayTeam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    .trim();
  const label = `${market.marketName} ${market.selectionName}`;
  let score = textSimilarity(teamless || request.text, label);
  const lower = request.text.toLowerCase();
  const selection = market.selectionName.toLowerCase();
  const marketName = market.marketName.toLowerCase();
  if (/\bover\b/.test(lower) && selection.includes('over')) score += 0.35;
  if (/\bunder\b/.test(lower) && selection.includes('under')) score += 0.35;
  if (/\b(draw|x)\b/.test(lower) && /draw|\bx\b/.test(selection)) score += 0.35;
  if (/both teams|btts/.test(lower) && /both teams|btts/.test(`${marketName} ${selection}`))
    score += 0.45;
  if (/double chance/.test(lower) && marketName.includes('double chance')) score += 0.4;
  if (/\bwin\b/.test(lower)) {
    if (
      lower.includes(event.homeTeam.toLowerCase()) &&
      selection.includes(event.homeTeam.toLowerCase())
    )
      score += 0.45;
    if (
      lower.includes(event.awayTeam.toLowerCase()) &&
      selection.includes(event.awayTeam.toLowerCase())
    )
      score += 0.45;
  }
  const line = /(?:over|under)\s*(\d+(?:\.\d+)?)/i.exec(request.text)?.[1];
  if (line && label.includes(line)) score += 0.35;
  return score;
}

export function parseTypedPicks(text: string): PickRequest[] {
  const cleaned = text
    .replace(/^\s*(?:book|add|use)\s+(?:these|this|my)?\s*(?:picks?|games?|selections?)?\s*:*/i, '')
    .trim();
  return cleaned
    .split(/\r?\n|\s*;\s*/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length >= 4)
    .map((line) => ({ text: line }));
}

export function screenshotPickRequests(extraction: ScreenshotExtraction): PickRequest[] {
  return extraction.items
    .filter((item) => item.confidence >= 0.55 && (item.market || item.selection))
    .map((item) => ({
      text: [item.market, item.selection, item.odds ? String(item.odds) : undefined]
        .filter(Boolean)
        .join(' '),
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      ...(item.competition ? { competition: item.competition } : {}),
      confidence: item.confidence,
    }));
}

export async function buildImportedSlip(
  provider: SportyBetProvider,
  requests: PickRequest[],
): Promise<{ slip: SlipDraft; unmatched: string[] }> {
  const eventGroups = await Promise.allSettled([
    provider.listEvents('football'),
    provider.listEvents('basketball'),
  ]);
  const events = eventGroups.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
  const selections: CandidateSelection[] = [];
  const unmatched: string[] = [];
  for (const request of requests.slice(0, 30)) {
    const ranked = events
      .filter((event) => event.status === 'scheduled')
      .map((event) => ({ event, score: eventScore(request, event) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const threshold = request.homeTeam && request.awayTeam ? 0.68 : 0.35;
    if (!best || best.score < threshold) {
      unmatched.push(request.text);
      continue;
    }
    const markets = (await provider.getMarkets(best.event.providerEventId))
      .filter((market) => market.status === 'active')
      .map((market) => ({ market, score: marketScore(request, best.event, market) }))
      .sort((a, b) => b.score - a.score);
    const chosen = markets[0];
    if (!chosen || chosen.score < 0.28) {
      unmatched.push(request.text);
      continue;
    }
    const sport: Sport = chosen.market.sport;
    const confidence = Math.round(
      Math.min(95, Math.max(35, (request.confidence ?? best.score) * 100)),
    );
    selections.push({
      ...chosen.market,
      fixture: {
        id: best.event.providerEventId,
        providerId: best.event.providerEventId,
        sport,
        league: request.competition ?? 'SportyBet',
        homeTeam: best.event.homeTeam,
        awayTeam: best.event.awayTeam,
        startsAt: best.event.startsAt,
        status: best.event.status,
      },
      modelProbability: confidence,
      confidenceScore: confidence,
      dataQuality: request.confidence && request.confidence >= 0.8 ? 'high' : 'medium',
      riskLevel: riskLevel(chosen.market.odds),
      reasoning: [
        `Matched from: “${request.text.slice(0, 100)}”.`,
        'Pending required AI analysis.',
      ],
    });
  }
  if (!selections.length)
    throw new Error('None of those picks could be matched to active SportyBet markets.');
  return {
    slip: { id: crypto.randomUUID(), selections, riskMode: 'balanced' },
    unmatched,
  };
}
