import { describe, expect, it } from 'vitest';
import { ConfidenceEngine } from '../src/analysis/confidence-engine.js';
import { MarketCatalog, MarketRanker } from '../src/markets/catalog.js';
import { candidate } from './fixtures.js';

describe('market normalization and ranking', () => {
  it('normalizes provider fields and suspended status', () => {
    const normalized = new MarketCatalog().normalize({
      marketId: 12,
      selectionId: 'x',
      eventId: 'event',
      sport: 'football',
      marketName: 'Bookings - Over/Under',
      selectionName: 'Over 3.5',
      odds: '1.72',
      active: false,
    });
    expect(normalized).toMatchObject({ category: 'cards', odds: 1.72, status: 'suspended' });
  });

  it('ranks viable high-confidence markets above weaker choices', () => {
    const ranked = new MarketRanker().rank([
      candidate(1, 2.1, 55, { riskLevel: 'higher' }),
      candidate(2, 1.35, 82),
    ]);
    expect(ranked[0]?.providerSelectionId).toBe('selection-2');
  });
});

describe('confidence calculation', () => {
  it('accounts for data quality and variance', () => {
    expect(
      new ConfidenceEngine().calculate({
        probability: 78,
        dataCompleteness: 0.9,
        sampleSize: 12,
        marketVariance: 0.2,
      }),
    ).toMatchObject({ modelProbability: 78, dataQuality: 'high', riskLevel: 'lower' });
  });
});
