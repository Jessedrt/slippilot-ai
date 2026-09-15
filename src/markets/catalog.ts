import { z } from 'zod';
import type { CandidateSelection, NormalizedMarket, RiskMode } from '../types/domain.js';

const providerMarketSchema = z.object({
  marketId: z.union([z.string(), z.number()]).transform(String),
  selectionId: z.union([z.string(), z.number()]).transform(String),
  eventId: z.union([z.string(), z.number()]).transform(String),
  sport: z.enum(['football', 'basketball']),
  marketName: z.string().min(1),
  selectionName: z.string().min(1),
  odds: z.coerce.number().positive(),
  line: z.coerce.number().optional(),
  active: z.boolean().default(true),
  updatedAt: z.coerce.date().optional(),
});

export type ProviderMarket = z.input<typeof providerMarketSchema>;

const categoryRules: Array<[RegExp, string]> = [
  [/corner/i, 'corners'],
  [/card|booking/i, 'cards'],
  [/player/i, 'player'],
  [/half|quarter/i, 'periods'],
  [/goal|over\/under|total/i, 'totals'],
  [/handicap|spread/i, 'handicap'],
  [/both teams|gg\/ng/i, 'btts'],
  [/1x2|match result|moneyline/i, 'result'],
];

export class MarketCatalog {
  normalize(raw: unknown): NormalizedMarket {
    const market = providerMarketSchema.parse(raw);
    return {
      providerMarketId: market.marketId,
      providerSelectionId: market.selectionId,
      eventId: market.eventId,
      sport: market.sport,
      category: categoryRules.find(([rule]) => rule.test(market.marketName))?.[1] ?? 'other',
      marketName: market.marketName.trim(),
      selectionName: market.selectionName.trim(),
      odds: market.odds,
      ...(market.line !== undefined ? { line: market.line } : {}),
      status: market.active ? 'active' : 'suspended',
      lastUpdated: market.updatedAt ?? new Date(),
    };
  }
}

export class MarketRanker {
  rank(selections: CandidateSelection[], mode: RiskMode = 'balanced'): CandidateSelection[] {
    const riskWeight = mode === 'conservative' ? 0.35 : mode === 'aggressive' ? 0.08 : 0.2;
    return [...selections]
      .filter((item) => item.status === 'active')
      .sort((a, b) => this.score(b, riskWeight) - this.score(a, riskWeight));
  }

  private score(item: CandidateSelection, riskWeight: number): number {
    const data = { low: 0.6, medium: 0.8, high: 1 }[item.dataQuality];
    const risk = { lower: 1, medium: 0.65, higher: 0.25 }[item.riskLevel];
    const value = Math.max(0, item.modelProbability / 100 - 1 / item.odds);
    return item.confidenceScore * data + risk * riskWeight * 10 + value * 10;
  }
}
