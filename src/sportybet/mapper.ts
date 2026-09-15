import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';
import type { ProviderSelection, SportyBetEvent } from './contracts.js';

const normalizeName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|bc|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

export function nameSimilarity(left: string, right: string): number {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (a === b) return 1;
  if (!a || !b) return 0;
  const grams = (value: string) =>
    new Set(Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)));
  const ga = grams(a);
  const gb = grams(b);
  const overlap = [...ga].filter((gram) => gb.has(gram)).length;
  return (2 * overlap) / (ga.size + gb.size);
}

export class SportyBetEventMapper {
  match(
    selection: CandidateSelection,
    events: SportyBetEvent[],
    threshold = 0.78,
  ): SportyBetEvent | null {
    const ranked = events
      .map((event) => ({
        event,
        score:
          (nameSimilarity(selection.fixture.homeTeam, event.homeTeam) +
            nameSimilarity(selection.fixture.awayTeam, event.awayTeam)) /
          2,
      }))
      .sort((a, b) => b.score - a.score);
    return ranked[0] && ranked[0].score >= threshold ? ranked[0].event : null;
  }
}

export class SportyBetMarketMapper {
  match(selection: CandidateSelection, markets: NormalizedMarket[]): NormalizedMarket | null {
    return (
      markets
        .filter((market) => market.status === 'active')
        .map((market) => ({
          market,
          score:
            nameSimilarity(selection.marketName, market.marketName) * 0.6 +
            nameSimilarity(selection.selectionName, market.selectionName) * 0.4,
        }))
        .sort((a, b) => b.score - a.score)
        .find((item) => item.score >= 0.8)?.market ?? null
    );
  }

  toProviderSelection(market: NormalizedMarket): ProviderSelection {
    return {
      eventId: market.eventId,
      marketId: market.providerMarketId,
      selectionId: market.providerSelectionId,
      odds: market.odds,
    };
  }
}
