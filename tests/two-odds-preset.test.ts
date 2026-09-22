import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlipAnalyzer, SlipAnalysis } from '../src/ai/slip-analyzer.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import { buildReviewedLiveSlipSnapshot } from '../src/sportybet/market-review.js';
import { selectTwoOddsPicks } from '../src/sportybet/two-odds-preset.js';
import { candidate } from './fixtures.js';

const option = (
  id: number,
  hour: number,
  odds: number,
  confidence: number,
  verdict: 'keep' | 'caution' | 'reject' = 'keep',
  risk: 'lower' | 'medium' | 'higher' = 'lower',
) => {
  const base = candidate(id, odds);
  return {
    candidate: {
      ...base,
      fixture: {
        ...base.fixture,
        startsAt: new Date(`2026-09-20T${String(hour).padStart(2, '0')}:00:00Z`),
      },
    },
    review: { index: id, confidence, verdict, risk, reason: 'Reviewed market evidence.' },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T05:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('conservative 2.00 odds preset', () => {
  it('reviews the whole day, ranks stronger evidence and spans morning and evening windows', () => {
    const picks = selectTwoOddsPicks(
      [
        option(1, 8, 1.3, 58),
        option(2, 8, 1.29, 94),
        option(3, 8, 1.31, 90),
        option(4, 20, 1.27, 91),
        option(5, 20, 1.28, 89),
      ],
      3,
      Math.pow(2, 1 / 3),
    );
    expect(picks.map((pick) => pick.candidate.eventId)).toEqual(['event-2', 'event-4', 'event-3']);
  });

  it('will not pad the target using caution, rejected or higher-risk markets', () => {
    const picks = selectTwoOddsPicks(
      [
        option(1, 8, 1.12, 99, 'caution', 'lower'),
        option(2, 8, 1.09, 99, 'keep', 'higher'),
        option(3, 8, 1.14, 99, 'reject', 'lower'),
        option(4, 20, 1.3, 86),
      ],
      3,
      Math.pow(2, 1 / 3),
    );
    expect(picks.map((pick) => pick.candidate.eventId)).toEqual(['event-4']);
  });

  it('uses only verified lower-risk outcomes meeting the 68 pass mark and returns a shortfall rather than forcing 2.00', async () => {
    const events = [1, 2, 3, 4].map((id) => ({
      providerEventId: `event-${id}`,
      homeTeam: `Home ${id}`,
      awayTeam: `Away ${id}`,
      league: 'Premier League',
      startsAt: new Date(`2026-09-20T${id === 4 ? '20' : '08'}:00:00Z`),
      status: 'scheduled' as const,
    }));
    const provider: SportyBetProvider = {
      name: 'SportyBet',
      listEvents: () => Promise.resolve(events),
      findEvents: () => Promise.resolve([]),
      getEvent: (id) =>
        Promise.resolve(events.find((event) => event.providerEventId === id) ?? null),
      getMarkets: (eventId) =>
        Promise.resolve([
          {
            eventId,
            providerMarketId: `market-${eventId}`,
            providerSelectionId: `outcome-${eventId}`,
            sport: 'football',
            category: 'winner',
            marketName: 'Winner',
            selectionName: 'Home',
            odds: 1.24,
            status: 'active',
            lastUpdated: new Date(),
          },
        ]),
      refreshSelections: (selections) =>
        Promise.resolve(selections.filter((selection) => selection.eventId !== 'event-2')),
      resolveBookingCode: () => Promise.resolve([]),
      createBookingCode: () => Promise.resolve('TEST123'),
      health: () => Promise.resolve({ ok: true, detail: 'test' }),
    };
    const analyzer: SlipAnalyzer = {
      analyze: (candidates) =>
        Promise.resolve({
          model: 'test',
          analyzedAt: new Date().toISOString(),
          summary: 'Fixture odds only, no win forecasts.',
          selections: candidates.map((item, index): SlipAnalysis['selections'][number] => ({
            index: index + 1,
            confidence: item.eventId === 'event-1' ? 68 : 90,
            statisticalSupport: 'supported',
            verdict: item.eventId === 'event-3' ? 'caution' : 'keep',
            risk: item.eventId === 'event-3' ? 'medium' : 'lower',
            reason: 'Based on supplied evidence only.',
          })),
        }),
    };
    const result = await buildReviewedLiveSlipSnapshot(
      provider,
      analyzer,
      'football',
      3,
      2,
      'conservative',
    );
    expect(result.slip.selections.map((item) => item.eventId)).toEqual(['event-4', 'event-1']);
    expect(result.slip.selections.every((item) => item.riskLevel === 'lower')).toBe(true);
    expect(result.combinedOdds).toBe(1.54);
    expect(result.analysis.summary).toContain('Only 2 of 3 requested fixtures qualified');
  });
});
