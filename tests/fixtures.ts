import type { CandidateSelection } from '../src/types/domain.js';

export function candidate(
  id: number,
  odds: number,
  probability = 75,
  overrides: Partial<CandidateSelection> = {},
): CandidateSelection {
  return {
    providerMarketId: `market-${id}`,
    providerSelectionId: `selection-${id}`,
    eventId: `event-${id}`,
    sport: 'football',
    category: 'totals',
    marketName: 'Over/Under Goals',
    selectionName: 'Over 1.5',
    odds,
    status: 'active',
    lastUpdated: new Date('2026-09-15T09:00:00Z'),
    fixture: {
      id: `fixture-${id}`,
      sport: 'football',
      league: 'Test League',
      homeTeam: `Home ${id}`,
      awayTeam: `Away ${id}`,
      startsAt: new Date('2026-09-16T12:00:00Z'),
      status: 'scheduled',
    },
    modelProbability: probability,
    confidenceScore: probability / 10,
    dataQuality: 'high',
    riskLevel: probability >= 75 ? 'lower' : 'medium',
    reasoning: ['Test evidence'],
    assessment: {
      evidenceQualityScore: 80,
      statisticalSupport: 'supported',
      recommendationVerdict: 'keep',
      assessedAt: new Date('2026-09-15T09:00:00Z'),
      expiresAt: new Date('2099-09-15T09:30:00Z'),
      sources: [
        {
          name: 'Deterministic test fixture',
          url: 'https://stats.example.test/event',
          retrievedAt: new Date('2026-09-15T09:00:00Z'),
          kind: 'authorized-statistics',
        },
      ],
      conflictingEvidence: false,
      bookmakerImpliedProbability: Number((100 / odds).toFixed(2)),
    },
    ...overrides,
  };
}
