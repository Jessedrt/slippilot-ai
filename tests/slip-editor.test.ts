import { describe, expect, it } from 'vitest';
import { deterministicParse } from '../src/ai/intent-parser.js';
import { editSlip } from '../src/slips/editor.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import { candidate } from './fixtures.js';

const provider: SportyBetProvider = {
  name: 'SportyBet',
  listEvents: () => Promise.resolve([]),
  findEvents: () => Promise.resolve([]),
  getEvent: () => Promise.resolve(null),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TEST'),
  getMarkets: (eventId) =>
    Promise.resolve([
      {
        ...candidate(99, 1.3),
        eventId,
        providerSelectionId: `${eventId}-safe`,
        providerMarketId: `${eventId}-market`,
        category: 'goals',
        marketName: 'Total Goals',
        selectionName: 'Over 1.5',
        sport: 'football',
      },
    ]),
  health: () => Promise.resolve({ ok: true, detail: 'ok' }),
};

const slip = {
  id: 'slip-1',
  selections: [candidate(1, 1.5, 80), candidate(2, 1.7, 60), candidate(3, 1.4, 75)],
  riskMode: 'balanced' as const,
};

describe('stateful slip editing', () => {
  it('removes the weakest requested selection', async () => {
    const result = await editSlip(slip, {
      intent: deterministicParse('Remove the weakest one'),
      rawText: 'Remove the weakest one',
      sportyBet: provider,
    });
    expect(result.selections.map((item) => item.eventId)).toEqual(['event-1', 'event-3']);
  });

  it('converts current selections to active goal markets', async () => {
    const result = await editSlip(slip, {
      intent: deterministicParse('Change these to goal markets'),
      rawText: 'Change these to goal markets',
      sportyBet: provider,
    });
    expect(result.selections.every((item) => item.category === 'goals')).toBe(true);
    expect(result.id).not.toBe(slip.id);
  });
});
