import { describe, expect, it } from 'vitest';
import {
  buildImportedSlip,
  parseTypedPicks,
  screenshotPickRequests,
} from '../src/sportybet/importer.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const provider: SportyBetProvider = {
  name: 'SportyBet',
  listEvents: (sport) =>
    Promise.resolve(
      sport === 'football'
        ? [
            {
              providerEventId: 'e1',
              homeTeam: 'West Ham United',
              awayTeam: 'Chelsea',
              startsAt: new Date(Date.now() + 3_600_000),
              status: 'scheduled',
            },
          ]
        : [],
    ),
  findEvents: () => Promise.resolve([]),
  getEvent: () => Promise.resolve(null),
  getMarkets: () =>
    Promise.resolve([
      {
        providerMarketId: 'm1',
        providerSelectionId: 's1',
        eventId: 'e1',
        sport: 'football',
        category: 'result',
        marketName: '1X2',
        selectionName: 'West Ham United',
        odds: 1.8,
        status: 'active',
        lastUpdated: new Date(),
      },
      {
        providerMarketId: 'm2',
        providerSelectionId: 's2',
        eventId: 'e1',
        sport: 'football',
        category: 'totals',
        marketName: 'Total Goals',
        selectionName: 'Over 2.5',
        odds: 1.65,
        status: 'active',
        lastUpdated: new Date(),
      },
    ]),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('CODE'),
  health: () => Promise.resolve({ ok: true, detail: 'ok' }),
};

describe('SportyBet pick importer', () => {
  it('parses numbered typed picks', () => {
    expect(parseTypedPicks('Book these picks:\n1. West Ham win\n2. Chelsea over 2.5')).toEqual([
      { text: 'West Ham win' },
      { text: 'Chelsea over 2.5' },
    ]);
  });

  it('maps a typed pick to a live market', async () => {
    const result = await buildImportedSlip(provider, [{ text: 'West Ham United win' }]);
    expect(result.slip.selections).toHaveLength(1);
    expect(result.slip.selections[0]?.providerSelectionId).toBe('s1');
  });

  it('turns confident screenshot rows into requests', () => {
    const requests = screenshotPickRequests({
      items: [
        {
          homeTeam: 'West Ham United',
          awayTeam: 'Chelsea',
          market: 'Total Goals',
          selection: 'Over 2.5',
          odds: 1.65,
          confidence: 0.9,
          uncertainFields: [],
        },
      ],
      bookingCodes: [],
    });
    expect(requests[0]?.text).toContain('Over 2.5');
  });
});
