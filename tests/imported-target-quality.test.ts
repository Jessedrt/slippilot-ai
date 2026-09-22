import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { importBookingCode } from '../src/api/code-workspace-routes.js';
import { registerSlipEditorRoutes } from '../src/api/slip-editor-routes.js';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const telegramBotToken = '123456789:example-token';
const initData = 'test-telegram-init-data';
const start = new Date('2099-09-21T18:00:00Z');
const sportyBet: SportyBetProvider = {
  name: 'SportyBet',
  listEvents: () => Promise.resolve([]),
  findEvents: () => Promise.resolve([]),
  getEvent: (id) =>
    Promise.resolve({
      providerEventId: id,
      homeTeam: `Home ${id}`,
      awayTeam: `Away ${id}`,
      startsAt: start,
      status: 'scheduled',
    }),
  getMarkets: (id) =>
    Promise.resolve([
      {
        eventId: id,
        providerMarketId: 'm',
        providerSelectionId: 's',
        sport: 'football',
        category: 'goals',
        marketName: 'Total',
        selectionName: 'Over 1.5',
        odds: 1.5,
        status: 'active',
        lastUpdated: new Date(),
      },
    ]),
  resolveBookingCode: () =>
    Promise.resolve([
      { eventId: 'lower', marketId: 'm', selectionId: 's', odds: 1.5 },
      { eventId: 'higher', marketId: 'm', selectionId: 's', odds: 1.5 },
    ]),
  createBookingCode: () => Promise.resolve('TESTCODE'),
  health: () => Promise.resolve({ ok: true, detail: 'ok' }),
};
const slipAnalyzer: SlipAnalyzer = {
  analyze: (candidates) =>
    Promise.resolve({
      model: 'mock',
      analyzedAt: new Date().toISOString(),
      summary: 'Provider markets checked.',
      selections: candidates.map((pick, index) => ({
        index: index + 1,
        confidence: pick.eventId === 'lower' ? 60 : 85,
        statisticalSupport: 'supported' as const,
        risk: 'lower' as const,
        verdict: 'keep' as const,
        reason: 'Reviewed.',
      })),
    }),
};

describe('strict imported-code targets preserve score policy', () => {
  it.each([2, 5])('requires 68 for %i odds, then keeps that minimum signed', async (targetOdds) => {
    const deps = { sportyBet, slipAnalyzer, telegramBotToken };
    const imported = await importBookingCode('ABCD12', deps, initData);
    const original = imported.editableSlip!;
    expect(original.qualityMinimum).toBe(55);
    const app = Fastify();
    await app.register(sensible);
    registerSlipEditorRoutes(app, deps);
    const payload = {
      action: 'reanalyze',
      riskMode: 'balanced',
      analysisToken: original.analysisToken,
      targetOdds,
      selections: original.selections,
    };
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/miniapp/edit-slip',
      headers: { 'x-telegram-init-data': initData },
      payload,
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json<{ message: string }>().message).toContain('68/100');
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/miniapp/edit-slip',
      headers: { 'x-telegram-init-data': initData },
      payload: {
        ...payload,
        selections: original.selections.filter((pick) => pick.confidence >= 68),
      },
    });
    expect(accepted.statusCode).toBe(200);
    const approved = accepted.json<{
      qualityMinimum: number;
      analysisToken: string;
      selections: typeof original.selections;
    }>();
    expect(approved.qualityMinimum).toBe(68);
    expect(approved.selections.map((pick) => pick.eventId)).toEqual(['higher']);
    const attemptedLowering = await app.inject({
      method: 'POST',
      url: '/api/miniapp/edit-slip',
      headers: { 'x-telegram-init-data': initData },
      payload: {
        ...payload,
        targetOdds: 10,
        selections: approved.selections,
        analysisToken: approved.analysisToken,
      },
    });
    expect(attemptedLowering.statusCode).toBe(200);
    expect(attemptedLowering.json<{ qualityMinimum: number }>().qualityMinimum).toBe(68);
    await app.close();
  });
});
