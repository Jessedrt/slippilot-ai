import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLiveSlipSnapshot, lagosCalendarDay } from '../src/sportybet/discovery.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const baseTime = new Date('2026-09-16T09:00:00.000Z');
function makeProvider(todayCount: number, tomorrowCount: number, followingCount = 0,
  noMarkets = new Set<string>()): SportyBetProvider {
  const counts = [todayCount, tomorrowCount, followingCount];
  const fixtures = counts.flatMap((count, offset) => Array.from({ length: count }, (_, index) => ({
    providerEventId: `day${offset}-event${index}`,
    homeTeam: `Home ${offset}-${index}`, awayTeam: `Away ${offset}-${index}`,
    startsAt: new Date(baseTime.getTime() + offset * 86_400_000 + 60_000),
    status: 'scheduled' as const,
  })));
  const getMarkets = (eventId: string): Promise<NormalizedMarket[]> => Promise.resolve(
    noMarkets.has(eventId) ? [] : [{ eventId, providerMarketId: '1', providerSelectionId: '1',
      sport: 'football', category: 'Main', marketName: '1X2', selectionName: 'Home',
      odds: 1.4, status: 'active', lastUpdated: baseTime }]);
  return { name: 'SportyBet', listEvents: () => Promise.resolve(fixtures), getMarkets,
    findEvents: () => Promise.resolve([]), getEvent: () => Promise.resolve(null),
    resolveBookingCode: () => Promise.resolve([]),
    createBookingCode: () => Promise.resolve('TEST123'),
    health: () => Promise.resolve({ ok: true, detail: 'test' }) };
}
afterEach(() => vi.useRealTimers());
describe('Africa/Lagos three-day verified fixture fallback', () => {
  it('uses the Lagos calendar day rather than a rolling 24-hour window', () => {
    expect(lagosCalendarDay(new Date('2026-09-16T21:30:00Z'))).not.toBe(
      lagosCalendarDay(new Date('2026-09-16T23:30:00Z')));
  });
  it('retains 40 eligible today fixtures without mixing tomorrow to fill a request for 45', async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const result = await buildLiveSlipSnapshot(makeProvider(40, 10), 'football', 45, 10, false);
    expect(result.dayOffset).toBe(0);
    expect(result.slip.selections).toHaveLength(40);
    expect(new Set(result.slip.selections.map((pick) => pick.eventId)).size).toBe(40);
    expect(result.slip.selections.every((pick) => lagosCalendarDay(pick.fixture.startsAt) === lagosCalendarDay(baseTime))).toBe(true);
  });
  it('uses tomorrow when today has no eligible fixtures and labels the date', async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const result = await buildLiveSlipSnapshot(makeProvider(0, 12), 'football', 5, 3, false);
    expect(result.dayOffset).toBe(1);
    expect(result.scheduleDate).toBe(lagosCalendarDay(new Date(baseTime.getTime() + 86_400_000)));
    expect(result.slip.selections).toHaveLength(5);
    expect(result.slip.selections.every((pick) => lagosCalendarDay(pick.fixture.startsAt) === result.scheduleDate)).toBe(true);
  });
  it('tries the following day if today and tomorrow lack available active markets', async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    const result = await buildLiveSlipSnapshot(makeProvider(1, 1, 3,
      new Set(['day0-event0', 'day1-event0'])), 'football', 2, 2);
    expect(result.dayOffset).toBe(2);
    expect(result.slip.selections).toHaveLength(2);
    expect(result.slip.selections.every((pick) => lagosCalendarDay(pick.fixture.startsAt) === result.scheduleDate)).toBe(true);
  });
  it('reports honest absence after three days, never searches day four', async () => {
    vi.useFakeTimers(); vi.setSystemTime(baseTime);
    await expect(buildLiveSlipSnapshot(makeProvider(0, 0, 0), 'football', 5, 3))
      .rejects.toThrow(/today, tomorrow or the following day/);
  });
  it('rejects invalid counts instead of silently clamping them', async () => {
    await expect(buildLiveSlipSnapshot(makeProvider(5, 0), 'football', 0))
      .rejects.toThrow(/positive whole number/);
  });
});
