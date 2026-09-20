import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import { registerCodeMarketOptions } from '../src/api/code-market-options.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import { buildReviewedLiveSlipSnapshot, MarketReviewUnavailableError,
  shortlistMarketOptions } from '../src/sportybet/market-review.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const fixture = (id: string) => ({
  providerEventId: id, homeTeam: 'Team A', awayTeam: 'Team B',
  startsAt: new Date(Date.now() + 3_600_000), status: 'scheduled' as const,
});
const option = (eventId: string, id: string, marketName: string, selectionName: string,
  odds: number, status: NormalizedMarket['status'] = 'active'): NormalizedMarket => ({
  eventId, providerMarketId: id, providerSelectionId: `${id}-${selectionName}`,
  sport: 'basketball', category: 'Basketball', marketName, selectionName,
  odds, status, lastUpdated: new Date(),
});
const provider = (id: string, markets: NormalizedMarket[]): SportyBetProvider => ({
  name: 'SportyBet', listEvents: () => Promise.resolve([fixture(id)]),
  findEvents: () => Promise.resolve([fixture(id)]),
  getEvent: () => Promise.resolve(fixture(id)),
  getMarkets: () => Promise.resolve(markets),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TEST123'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
});
const reviewer: SlipAnalyzer = {
  analyze: (candidates) => Promise.resolve({
    model: 'test-market-review', analyzedAt: new Date().toISOString(),
    summary: 'Evidence-quality comparison, not a predicted result.',
    selections: candidates.map((candidate, index) => ({
      index: index + 1,
      confidence: candidate.selectionName.startsWith('Under') ? 88 : 42,
      risk: candidate.selectionName.startsWith('Under') ? 'lower' as const : 'higher' as const,
      verdict: candidate.selectionName.startsWith('Under') ? 'keep' as const : 'caution' as const,
      reason: 'Model assessment based only on supplied market evidence.',
    })),
  }),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('automatic market option review', () => {
  it('reviews both directions, chooses a better-reviewed Under and reuses each provider snapshot', async () => {
    const id = 'sr:match:101';
    const markets = [
      option(id, 'total', 'Over/Under (incl. overtime)', 'Over 165.5', 1.80),
      option(id, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.64),
      option(id, 'winner', 'Winner (incl. overtime)', 'Home', 1.90),
      option(id, 'spread', 'Handicap', 'Away +2.5', 1.72),
      option(id, 'player', 'Player Total Points', 'Over 18.5', 2.05),
      option(id, 'suspended', 'Total', 'Over 180.5', 1.8, 'suspended'),
      option(id, 'invalid', 'Total', 'Under 190.5', Number.NaN),
    ];
    const source = provider(id, markets);
    const getMarkets = vi.fn(source.getMarkets);
    const analyze = vi.fn(reviewer.analyze);
    const result = await buildReviewedLiveSlipSnapshot({ ...source, getMarkets },
      { analyze }, 'basketball', 1, 1.8);
    expect(getMarkets).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]![0].map((item) => item.selectionName))
      .toEqual(expect.arrayContaining(['Over 165.5', 'Under 165.5', 'Home', 'Away +2.5']));
    expect(result.slip.selections).toHaveLength(1);
    expect(result.slip.selections[0]?.selectionName).toBe('Under 165.5');
    expect(result.slip.selections[0]?.modelProbability).toBe(0);
    expect(result.analysis.selections[0]?.confidence).toBe(88);
    expect(result.reviewedOptions).toBe(5);
  });

  it('does not impose market-category bans but excludes invalid or suspended prices', () => {
    const id = 'sr:match:102';
    const markets = [option(id, 'winner', 'Winner', 'Away', 1.85),
      option(id, 'period', '4th Quarter', 'Under 41.5', 1.81),
      option(id, 'player', 'Player Points', 'Over 18.5', 1.80),
      option(id, 'invalid', 'Handicap', 'Home +2', 0.8),
      option(id, 'suspended', 'Handicap', 'Away -2', 2, 'suspended')];
    expect(shortlistMarketOptions(markets, 'basketball', id, 1.8)).toHaveLength(3);
    expect(shortlistMarketOptions(markets, 'basketball', id, 1.8).map((item) => item.selectionName))
      .toEqual(expect.arrayContaining(['Away', 'Under 41.5', 'Over 18.5']));
  });

  it('never inserts a rejected pick or substitutes an unreviewed market', async () => {
    const id = 'sr:match:103';
    const source = provider(id, [option(id, 'winner', 'Winner', 'Home', 1.7)]);
    const rejects: SlipAnalyzer = { analyze: (candidates) => Promise.resolve({
      model: 'test', analyzedAt: new Date().toISOString(), summary: 'No usable evidence.',
      selections: candidates.map((_candidate, index) => ({ index: index + 1,
        confidence: 0, risk: 'higher' as const, verdict: 'reject' as const,
        reason: 'Insufficient evidence.' })),
    }) };
    await expect(buildReviewedLiveSlipSnapshot(source, rejects, 'basketball', 1))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(buildReviewedLiveSlipSnapshot(source, { analyze: () => Promise.reject(new Error('offline')) },
      'basketball', 1)).rejects.toBeInstanceOf(MarketReviewUnavailableError);
  });
});

describe('booking-code editor options', () => {
  it('offers every active market including Under beyond the old 120-option cutoff', async () => {
    vi.useRealTimers();
    const id = 'sr:match:104';
    const markets = Array.from({ length: 130 }, (_value, index) =>
      option(id, String(index + 1), 'Basketball total', index === 129 ? 'Under 170.5' : `Over ${index + 10}.5`, 1.8));
    const app = Fastify();
    await app.register(sensible);
    registerCodeMarketOptions(app, provider(id, markets));
    try {
      const response = await app.inject({ method: 'POST', url: '/api/miniapp/code-options',
        payload: { eventId: id, sport: 'basketball' } });
      expect(response.statusCode).toBe(200);
      const output = response.json<{ totalActive: number; truncated: boolean;
        options: Array<{ selectionName: string }> }>();
      expect(output.totalActive).toBe(130);
      expect(output.truncated).toBe(false);
      expect(output.options).toHaveLength(130);
      expect(output.options.some((item) => item.selectionName === 'Under 170.5')).toBe(true);
    } finally { await app.close(); }
  });
});
