import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLiveSlipSnapshot,
  isAllowedBasketballOverMarket,
} from '../src/sportybet/discovery.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const event = (id: string, hoursFromNow = 2) => ({
  providerEventId: id,
  homeTeam: `Home ${id}`,
  awayTeam: `Away ${id}`,
  startsAt: new Date(Date.now() + hoursFromNow * 3_600_000),
  status: 'scheduled' as const,
});

const provider: SportyBetProvider = {
  name: 'SportyBet',
  listEvents: () => Promise.resolve([event('sr:match:1'), event('sr:match:2')]),
  findEvents: () => Promise.resolve([]),
  getEvent: () => Promise.resolve(null),
  getMarkets: (eventId) =>
    Promise.resolve([
      {
        providerMarketId: '219',
        providerSelectionId: `pick-${eventId}`,
        eventId,
        sport: 'basketball',
        category: 'Total',
        marketName: 'Over/Under (incl. overtime)',
        selectionName: 'Over 165.5',
        odds: 1.5,
        status: 'active',
        lastUpdated: new Date(),
      },
    ]),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TEST123'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('SportyBet live discovery', () => {
  it('does not exclude any basketball market category or Under outcome', () => {
    const allowed = (marketName: string, selectionName = 'Over 84.5') =>
      isAllowedBasketballOverMarket({ marketName, selectionName });
    expect(allowed('1st half - total')).toBe(true);
    expect(allowed('Over/Under (incl. overtime)', 'Over 169.5')).toBe(true);
    expect(allowed('Home O/U (incl. overtime)', 'Over 85.5')).toBe(true);
    expect(allowed('Away O/U (incl. overtime)', 'Over 83.5')).toBe(true);
    expect(allowed('xth quarter - total')).toBe(true);
    expect(allowed('2nd half - total')).toBe(true);
    expect(allowed('Winner (incl. overtime)', 'Home')).toBe(true);
    expect(allowed('Over/Under (incl. overtime)', 'Under 169.5')).toBe(true);
  });
  it('stops fetching markets once the requested count is available', async () => {
    let calls = 0;
    await buildLiveSlipSnapshot(
      {
        ...provider,
        listEvents: () => Promise.resolve(Array.from({ length: 30 }, (_, i) => event(String(i)))),
        getMarkets: (id) => {
          calls++;
          return provider.getMarkets(id);
        },
      },
      'basketball',
      5,
    );
    expect(calls).toBe(5);
  });
  it('replaces failed fixture lookups with later fixtures', async () => {
    const result = await buildLiveSlipSnapshot(
      {
        ...provider,
        listEvents: () => Promise.resolve([event('bad'), event('good')]),
        getMarkets: (id) =>
          id === 'bad' ? Promise.reject(new Error('timeout')) : provider.getMarkets(id),
      },
      'basketball',
      1,
    );
    expect(result.slip.selections[0]?.fixture.id).toBe('good');
  });
  it('builds a live slip without inventing fixtures or odds', async () => {
    const snapshot = await buildLiveSlipSnapshot(provider, 'basketball', 2, 2.25);
    expect(snapshot.combinedOdds).toBe(2.25);
    expect(snapshot.slip.selections).toHaveLength(2);
    expect(snapshot.slip.selections[0]).toMatchObject({
      odds: 1.5,
      fixture: { id: 'sr:match:1', sport: 'basketball' },
      reasoning: ['Live SportyBet market snapshot.', expect.any(String)],
    });
  });
  it('keeps daily presets inside the current Africa/Lagos calendar day', async () => {
    const snapshot = await buildLiveSlipSnapshot(
      {
        ...provider,
        listEvents: () =>
          Promise.resolve([
            { ...event('today'), startsAt: new Date('2026-09-16T15:00:00Z') },
            { ...event('tomorrow'), startsAt: new Date('2026-09-17T10:00:00Z') },
          ]),
      },
      'basketball',
      2,
      2.25,
      true,
    );
    expect(snapshot.slip.selections.map((selection) => selection.eventId)).toEqual(['today']);
  });
});
