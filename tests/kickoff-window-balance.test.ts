import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLiveSlipSnapshot, interleaveKickoffWindows } from '../src/sportybet/discovery.js';
import type { SportyBetProvider, SportyBetEvent } from '../src/sportybet/contracts.js';

const kickoff = (hourWAT: number) => new Date(Date.UTC(2026, 8, 16, hourWAT - 1));
const fixture = (id: string, hourWAT: number): SportyBetEvent => ({
  providerEventId: id,
  homeTeam: `Home ${id}`,
  awayTeam: `Away ${id}`,
  league: `League ${id}`,
  startsAt: kickoff(hourWAT),
  status: 'scheduled',
});
const fixtures = [
  ...Array.from({ length: 10 }, (_, index) => fixture(`morning-${index}`, 10)),
  ...Array.from({ length: 10 }, (_, index) => fixture(`evening-${index}`, 22)),
];

const makeProvider = (events: SportyBetEvent[], unavailable: (id: string) => boolean = () => false): SportyBetProvider => ({
  name: 'SportyBet',
  listEvents: () => Promise.resolve(events),
  findEvents: () => Promise.resolve([]),
  getEvent: (id) => Promise.resolve(events.find((item) => item.providerEventId === id) ?? null),
  getMarkets: (id) => Promise.resolve(unavailable(id) ? [] : [{
    providerMarketId: 'winner', providerSelectionId: `home-${id}`, eventId: id,
    sport: 'football', category: 'result', marketName: 'Match winner',
    selectionName: 'Home', odds: 1.4, status: 'active', lastUpdated: new Date(),
  }]),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TESTCODE'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T06:00:00Z')); // 07:00 Lagos; both windows are ahead.
});
afterEach(() => vi.useRealTimers());

describe('kickoff diversity in Lagos time', () => {
  it('rotates across morning and evening even when the provider lists all mornings first', () => {
    const ordered = interleaveKickoffWindows(fixtures);
    expect(ordered.slice(0, 10).filter((item) => item.providerEventId.startsWith('morning-'))).toHaveLength(5);
    expect(ordered.slice(0, 10).filter((item) => item.providerEventId.startsWith('evening-'))).toHaveLength(5);
  });

  it('builds ten verified picks from both 10am and 10pm, rather than taking only the first ten', async () => {
    const snapshot = await buildLiveSlipSnapshot(makeProvider(fixtures), 'football', 10);
    const picks = snapshot.slip.selections;
    expect(picks).toHaveLength(10);
    expect(picks.filter((pick) => pick.eventId.startsWith('morning-'))).toHaveLength(5);
    expect(picks.filter((pick) => pick.eventId.startsWith('evening-'))).toHaveLength(5);
    expect(picks.every((pick) => pick.status === 'active' && pick.fixture.status === 'scheduled')).toBe(true);
    expect(snapshot.dayOffset).toBe(0);
  });

  it('does not select morning fixtures once their kickoff is in the past', async () => {
    vi.setSystemTime(new Date('2026-09-16T11:00:00Z')); // 12:00 Lagos.
    const snapshot = await buildLiveSlipSnapshot(makeProvider(fixtures), 'football', 10);
    expect(snapshot.slip.selections).toHaveLength(10);
    expect(snapshot.slip.selections.every((pick) => pick.eventId.startsWith('evening-'))).toBe(true);
  });

  it('fills from the available window when evening markets cannot be verified', async () => {
    const snapshot = await buildLiveSlipSnapshot(
      makeProvider(fixtures, (id) => id.startsWith('evening-')), 'football', 10,
    );
    expect(snapshot.slip.selections).toHaveLength(10);
    expect(snapshot.slip.selections.every((pick) => pick.eventId.startsWith('morning-'))).toBe(true);
    expect(snapshot.dayOffset).toBe(0);
  });
});
