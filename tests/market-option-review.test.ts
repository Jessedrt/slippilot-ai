import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import { registerCodeMarketOptions } from '../src/api/code-market-options.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import {
  buildReviewedLiveSlipSnapshot,
  ResearchProviderUnavailableError,
  shortlistMarketOptions,
} from '../src/sportybet/market-review.js';
import type { NormalizedMarket } from '../src/types/domain.js';
import type { BasketballStatisticsProvider } from '../src/sports/basketball-statistics.js';
import { FixtureMappingError } from '../src/api-sports/fixture-matcher.js';
import { ApiSportsError } from '../src/api-sports/client.js';
import { AnalysisDeadlineError } from '../src/analysis/pipeline-control.js';

const fixture = (id: string) => ({
  providerEventId: id,
  homeTeam: 'Team A',
  awayTeam: 'Team B',
  startsAt: new Date(Date.now() + 3_600_000),
  status: 'scheduled' as const,
});
const option = (
  eventId: string,
  id: string,
  marketName: string,
  selectionName: string,
  odds: number,
  status: NormalizedMarket['status'] = 'active',
): NormalizedMarket => ({
  eventId,
  providerMarketId: id,
  providerSelectionId: `${id}-${selectionName}`,
  sport: 'basketball',
  category: 'Basketball',
  marketName,
  selectionName,
  odds,
  status,
  lastUpdated: new Date(),
});
const footballOption = (
  eventId: string,
  id: string,
  marketName: string,
  selectionName: string,
  odds: number,
): NormalizedMarket => ({
  ...option(eventId, id, marketName, selectionName, odds),
  sport: 'football',
  category: 'Football',
});
const provider = (id: string, markets: NormalizedMarket[]): SportyBetProvider => ({
  name: 'SportyBet',
  listEvents: () => Promise.resolve([fixture(id)]),
  findEvents: () => Promise.resolve([fixture(id)]),
  getEvent: () => Promise.resolve(fixture(id)),
  getMarkets: () => Promise.resolve(markets),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => Promise.resolve('TEST123'),
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
});
const statistics = (id: string, contradictions: string[] = []): BasketballStatisticsProvider => ({
  name: 'authorized-test-feed',
  getSnapshot: (request) =>
    Promise.resolve({
      providerEventId: `stats-${id}`,
      providerCompetitionId: 'stats-test-league',
      competition: request.competition,
      homeTeam: request.homeTeam,
      awayTeam: request.awayTeam,
      startsAt: request.startsAt,
      retrievedAt: new Date(),
      overtimeIncluded: true,
      lineupStatus: 'confirmed',
      contradictions,
      source: {
        name: 'Authorized test feed',
        url: 'https://stats.example.test/basketball',
        authorized: true,
      },
      home: {
        games: Array.from({ length: 5 }, (_, index) => ({
          playedAt: new Date(Date.now() - (index + 1) * 86_400_000),
          pointsFor: 74,
          pointsAgainst: 76,
          possessions: 70,
        })),
      },
      away: {
        games: Array.from({ length: 5 }, (_, index) => ({
          playedAt: new Date(Date.now() - (index + 1) * 86_400_000),
          pointsFor: 75,
          pointsAgainst: 77,
          possessions: 70,
        })),
      },
    }),
});
const reviewer: SlipAnalyzer = {
  analyze: (candidates) =>
    Promise.resolve({
      model: 'test-market-review',
      analyzedAt: new Date().toISOString(),
      summary: 'Evidence-quality comparison, not a predicted result.',
      selections: candidates.map((candidate, index) => ({
        index: index + 1,
        confidence: candidate.selectionName.startsWith('Under') ? 88 : 42,
        statisticalSupport: 'supported' as const,
        risk: candidate.selectionName.startsWith('Under')
          ? ('lower' as const)
          : ('higher' as const),
        verdict: candidate.selectionName.startsWith('Under')
          ? ('keep' as const)
          : ('caution' as const),
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
  it('reviews both directions, chooses a better-reviewed Under, excludes handicap and reuses each provider snapshot', async () => {
    const id = 'sr:match:101';
    const markets = [
      option(id, 'total', 'Over/Under (incl. overtime)', 'Over 165.5', 1.8),
      option(id, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.64),
      option(id, 'winner', 'Winner (incl. overtime)', 'Home', 1.9),
      option(id, 'spread', 'Handicap', 'Away +2.5', 1.72),
      option(id, 'player', 'Player Total Points', 'Over 18.5', 2.05),
      option(id, 'suspended', 'Total', 'Over 180.5', 1.8, 'suspended'),
      option(id, 'invalid', 'Total', 'Under 190.5', Number.NaN),
    ];
    const source = provider(id, markets);
    const getMarkets = vi.fn((eventId: string) => source.getMarkets(eventId));
    const analyze = vi.fn((candidates: Parameters<SlipAnalyzer['analyze']>[0]) =>
      reviewer.analyze(candidates),
    );
    const result = await buildReviewedLiveSlipSnapshot(
      { ...source, getMarkets },
      { analyze },
      'basketball',
      1,
      1.8,
      'balanced',
      statistics(id),
    );
    expect(getMarkets).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0]![0].map((item) => item.selectionName)).toEqual(['Under 165.5']);
    expect(analyze.mock.calls[0]![0].some((item) => item.marketName === 'Handicap')).toBe(false);
    expect(result.slip.selections).toHaveLength(1);
    expect(result.slip.selections[0]?.selectionName).toBe('Under 165.5');
    expect(result.slip.selections[0]?.modelProbability).toBe(0);
    expect(result.analysis.selections[0]?.confidence).toBe(88);
    expect(result.reviewedOptions).toBe(1);
  });

  it('excludes basketball handicap without banning totals, player props or later periods', () => {
    const id = 'sr:match:102';
    const markets = [
      option(id, 'winner', 'Winner', 'Away', 1.85),
      option(id, 'period', '4th Quarter', 'Under 41.5', 1.81),
      option(id, 'player', 'Player Points', 'Over 18.5', 1.8),
      option(id, 'spread', 'Point Spread', 'Home +4.5', 1.75),
      option(id, 'invalid', 'Handicap', 'Home +2', 0.8),
      option(id, 'suspended', 'Handicap', 'Away -2', 2, 'suspended'),
    ];
    expect(shortlistMarketOptions(markets, 'basketball', id, 1.8)).toHaveLength(3);
    expect(
      shortlistMarketOptions(markets, 'basketball', id, 1.8).map((item) => item.selectionName),
    ).toEqual(expect.arrayContaining(['Away', 'Under 41.5', 'Over 18.5']));
    expect(
      shortlistMarketOptions(markets, 'basketball', id, 1.8).some(
        (item) => item.marketName === 'Point Spread',
      ),
    ).toBe(false);
  });

  it('never inserts a rejected pick or substitutes an unreviewed market', async () => {
    const id = 'sr:match:103';
    const source = provider(id, [
      option(id, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.7),
    ]);
    const rejects: SlipAnalyzer = {
      analyze: (candidates) =>
        Promise.resolve({
          model: 'test',
          analyzedAt: new Date().toISOString(),
          summary: 'No usable evidence.',
          selections: candidates.map((_candidate, index) => ({
            index: index + 1,
            confidence: 0,
            risk: 'higher' as const,
            verdict: 'reject' as const,
            reason: 'Insufficient evidence.',
          })),
        }),
    };
    await expect(
      buildReviewedLiveSlipSnapshot(
        source,
        rejects,
        'basketball',
        1,
        undefined,
        'balanced',
        statistics(id),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      buildReviewedLiveSlipSnapshot(
        source,
        { analyze: () => Promise.reject(new Error('offline')) },
        'basketball',
        1,
        undefined,
        'balanced',
        statistics(id),
      ),
    ).rejects.toBeInstanceOf(ResearchProviderUnavailableError);
  });

  it('ranks supported markets by evidence and risk, not proximity to target odds', async () => {
    const id = 'sr:match:target-independent';
    const source = provider(id, [
      footballOption(id, 'a-strong', 'Match result', 'Evidence leader', 1.25),
      footballOption(id, 'b-target', 'Goals total', 'Price-near-target', 4.9),
    ]);
    const evidenceFirst: SlipAnalyzer = {
      analyze: (candidates) =>
        Promise.resolve({
          model: 'target-independent-test',
          analyzedAt: new Date().toISOString(),
          summary: 'Target price is not evidence.',
          selections: candidates.map((candidate, index) => ({
            index: index + 1,
            confidence: candidate.selectionName === 'Evidence leader' ? 92 : 76,
            evidenceQualityScore: candidate.selectionName === 'Evidence leader' ? 92 : 76,
            statisticalSupport: 'supported' as const,
            risk:
              candidate.selectionName === 'Evidence leader'
                ? ('lower' as const)
                : ('medium' as const),
            verdict: 'keep' as const,
            reason: 'Deterministic test review.',
          })),
        }),
    };
    const result = await buildReviewedLiveSlipSnapshot(source, evidenceFirst, 'football', 1, 5);
    expect(result.slip.selections[0]?.selectionName).toBe('Evidence leader');
    expect(result.combinedOdds).toBe(1.25);
  });

  it('fails safely when basketball statistics are unavailable or contradictory', async () => {
    const id = 'sr:match:105';
    const source = provider(id, [
      option(id, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.7),
    ]);
    await expect(
      buildReviewedLiveSlipSnapshot(source, reviewer, 'basketball', 1),
    ).rejects.toMatchObject({ statusCode: 424 });
    await expect(
      buildReviewedLiveSlipSnapshot(
        source,
        reviewer,
        'basketball',
        1,
        undefined,
        'balanced',
        statistics(id, ['two official feeds disagree']),
      ),
    ).rejects.toMatchObject({ statusCode: 424 });
    await expect(
      buildReviewedLiveSlipSnapshot(source, reviewer, 'basketball', 1, undefined, 'balanced', {
        name: 'offline-feed',
        getSnapshot: () => Promise.reject(new Error('upstream timeout')),
      }),
    ).rejects.toThrow('provider unavailable');
  });

  it('skips one unmapped fixture and still returns a later independently verified fixture', async () => {
    const first = 'sr:match:201';
    const second = 'sr:match:202';
    const events = [fixture(first), fixture(second)];
    const source: SportyBetProvider = {
      ...provider(first, []),
      listEvents: () => Promise.resolve(events),
      getMarkets: (eventId) =>
        Promise.resolve([
          option(eventId, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.7),
        ]),
    };
    const feed: BasketballStatisticsProvider = {
      ...statistics(second),
      getSnapshot: (request) =>
        request.bookmakerEventId === first
          ? Promise.reject(new FixtureMappingError('unmapped', 'No exact fixture matched.'))
          : statistics(second).getSnapshot(request),
    };
    const result = await buildReviewedLiveSlipSnapshot(
      source,
      reviewer,
      'basketball',
      2,
      undefined,
      'balanced',
      feed,
    );
    expect(result.slip.selections.map((selection) => selection.eventId)).toEqual([second]);
    expect(result.verification).toMatchObject({
      mappingRejected: 1,
      fixturesMapped: 1,
      mappingRejections: { unmapped: 1 },
    });
  });

  it('fails the complete build for systemic API-Sports failures', async () => {
    const id = 'sr:match:203';
    await expect(
      buildReviewedLiveSlipSnapshot(
        provider(id, [option(id, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.7)]),
        reviewer,
        'basketball',
        1,
        undefined,
        'balanced',
        {
          name: 'systemic-failure',
          getSnapshot: () =>
            Promise.reject(
              new ApiSportsError('missing_entitlement', 'Basketball subscription unavailable.'),
            ),
        },
      ),
    ).rejects.toMatchObject({ reasonCode: 'missing_subscription' });
  });

  it('stops slow verification at the explicit server deadline', async () => {
    vi.useRealTimers();
    const id = 'sr:match:204';
    const slow: BasketballStatisticsProvider = {
      name: 'slow-mock',
      getSnapshot: () => new Promise(() => undefined),
    };
    await expect(
      buildReviewedLiveSlipSnapshot(
        provider(id, [option(id, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.7)]),
        reviewer,
        'basketball',
        1,
        undefined,
        'balanced',
        slow,
        undefined,
        { deadlineAt: Date.now() + 30, concurrency: 2 },
      ),
    ).rejects.toBeInstanceOf(AnalysisDeadlineError);
  });

  it('bounds concurrency and stops a large target before the hosting deadline', async () => {
    vi.useRealTimers();
    const events = Array.from({ length: 20 }, (_value, index) => fixture(`sr:match:slow-${index}`));
    const source: SportyBetProvider = {
      ...provider(events[0]!.providerEventId, []),
      listEvents: () => Promise.resolve(events),
      getMarkets: (eventId) =>
        Promise.resolve([
          option(eventId, 'total', 'Over/Under (incl. overtime)', 'Under 165.5', 1.7),
        ]),
    };
    const getSnapshot = vi.fn(() => new Promise<never>(() => undefined));
    await expect(
      buildReviewedLiveSlipSnapshot(
        source,
        reviewer,
        'basketball',
        14,
        50,
        'conservative',
        { name: 'bounded-slow-mock', getSnapshot },
        undefined,
        { deadlineAt: Date.now() + 40, concurrency: 2 },
      ),
    ).rejects.toBeInstanceOf(AnalysisDeadlineError);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('booking-code editor options', () => {
  it('offers active markets including Under beyond the old 120-option cutoff but not basketball handicap', async () => {
    vi.useRealTimers();
    const id = 'sr:match:104';
    const markets = [
      ...Array.from({ length: 130 }, (_value, index) =>
        option(
          id,
          String(index + 1),
          'Basketball total',
          index === 129 ? 'Under 170.5' : `Over ${index + 10}.5`,
          1.8,
        ),
      ),
      option(id, 'handicap', 'Handicap', 'Home -4.5', 1.8),
    ];
    const app = Fastify();
    await app.register(sensible);
    registerCodeMarketOptions(app, provider(id, markets));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/miniapp/code-options',
        payload: { eventId: id, sport: 'basketball' },
      });
      expect(response.statusCode).toBe(200);
      const output = response.json<{
        totalActive: number;
        truncated: boolean;
        options: Array<{ selectionName: string }>;
      }>();
      expect(output.totalActive).toBe(130);
      expect(output.truncated).toBe(false);
      expect(output.options).toHaveLength(130);
      expect(output.options.some((item) => item.selectionName === 'Under 170.5')).toBe(true);
      expect(output.options.some((item) => item.selectionName === 'Home -4.5')).toBe(false);
    } finally {
      await app.close();
    }
  });
});
