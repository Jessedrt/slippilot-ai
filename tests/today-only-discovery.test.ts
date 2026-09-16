import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLiveSlipSnapshot, lagosCalendarDay } from '../src/sportybet/discovery.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const baseTime = new Date('2026-09-16T09:00:00.000Z');

function makeProvider(todayCount: number, tomorrowCount: number): SportyBetProvider {
  const fixtures = Array.from({ length: todayCount + tomorrowCount }, (_, index) => ({
    providerEventId: `sr:match:${index + 1}`,
    homeTeam: `Home ${index + 1}`,
    awayTeam: `Away ${index + 1}`,
    startsAt: new Date(baseTime.getTime() + (index < todayCount ? 60_000 : 86_400_000)),
    status: 'scheduled' as const,
  }));
  const getMarkets = (eventId: string): Promise<NormalizedMarket[]> => Promise.resolve([{
    eventId,
    providerMarketId: '1',
    providerSelectionId: '1',
    sport: 'football',
    category: 'Main',
    marketName: '1X2',
    selectionName: 'Home',
    odds: 1.4,
    status: 'active',
    lastUpdated: baseTime,
  }]);
  return {
    name: 'SportyBet',
    listEvents: () => Promise.resolve(fixtures),
    getMarkets,
    findEvents: () => Promise.resolve([]),
    getEvent: () => Promise.resolve(null),
    resolveBookingCode: () => Promise.resolve([]),
    createBookingCode: () => Promise.resolve('TEST123'),
    health: () => Promise.resolve({ ok: true, detail: 'test' }),
  };
}

afterEach(() => vi.useRealTimers());

describe('Lagos today-only selection policy', () => {
  it('uses the Lagos calendar day rather than a rolling 24-hour window', () => {
    expect(lagosCalendarDay(new Date('2026-09-16T21:30:00Z'))).not.toBe(
      lagosCalendarDay(new Date('2026-09-16T23:30:00Z')),
    );
  });

  it('supports more than 30 distinct games without using later dates to fill the request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    const result = await buildLiveSlipSnapshot(makeProvider(40, 10), 'football', 45, 10, false);
    expect(result.slip.selections).toHaveLength(40);
    expect(new Set(result.slip.selections.map((pick) => pick.eventId)).size).toBe(40);
    expect(result.slip.selections.every((pick) => lagosCalendarDay(pick.fixture.startsAt) === lagosCalendarDay(baseTime))).toBe(true);
  });

  it('never substitutes tomorrow when today has no eligible fixtures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    await expect(buildLiveSlipSnapshot(makeProvider(0, 12), 'football', 5, 3, false)).rejects.toThrow(/today in Lagos/);
  });

  it('rejects invalid counts instead of silently clamping them', async () => {
    await expect(buildLiveSlipSnapshot(makeProvider(5, 0), 'football', 0)).rejects.toThrow(/positive whole number/);
  });
});
