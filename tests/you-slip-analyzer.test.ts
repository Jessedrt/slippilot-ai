import { describe, expect, it, vi } from 'vitest';
import { YouSlipAnalyzer } from '../src/ai/you-slip-analyzer.js';
import { YouClient } from '../src/you/client.js';
import type { CandidateSelection } from '../src/types/domain.js';

const selection: CandidateSelection = {
  providerMarketId: '18',
  providerSelectionId: '12',
  eventId: 'sr:match:1',
  sport: 'football',
  category: 'Totals',
  marketName: 'Over/Under',
  selectionName: 'Over 2.5',
  odds: 1.85,
  status: 'active',
  lastUpdated: new Date(),
  fixture: {
    id: 'sr:match:1',
    sport: 'football',
    league: 'Example',
    homeTeam: 'Home',
    awayTeam: 'Away',
    startsAt: new Date('2026-09-18T18:00:00Z'),
    status: 'scheduled',
  },
  modelProbability: 0.5,
  confidenceScore: 50,
  dataQuality: 'medium',
  riskLevel: 'medium',
  reasoning: [],
};

const result = (indices = [1]) => ({
  output: {
    content: {
      summary: 'Insufficient statistical evidence; treat this market cautiously.',
      selections: indices.map((index) => ({
        index,
        confidence: 84,
        risk: 'medium',
        verdict: 'caution',
        reason: 'Bookmaker odds alone cannot establish outcome probability.',
      })),
    },
    content_type: 'object',
    sources: [],
  },
});

function createAnalyzer(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const client = new YouClient({
    apiKey: 'test-key-do-not-log',
    fetch: fetchMock,
    sleep: async () => {},
  });
  return { analyzer: new YouSlipAnalyzer(client), fetchMock };
}

describe('You.com primary slip analysis', () => {
  it('uses only YDC Research standard structured output and validates the complete slip', async () => {
    const { analyzer, fetchMock } = createAnalyzer(result());
    const analysis = await analyzer.analyze([selection]);
    expect(analysis.model).toBe('you-research-standard');
    expect(analysis.selections).toEqual([
      expect.objectContaining({ index: 1, confidence: 75, verdict: 'caution' }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.you.com/v1/research');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ 'X-API-Key': 'test-key-do-not-log' });
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload.research_effort).toBe('standard');
    expect(payload.output_schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });

  it('rejects missing and duplicate indices rather than silently approving a booking', async () => {
    const missing = createAnalyzer(result([]));
    await expect(missing.analyzer.analyze([selection])).rejects.toThrow('exactly once');
    const duplicated = createAnalyzer(result([1, 1]));
    await expect(duplicated.analyzer.analyze([selection, selection])).rejects.toThrow('exactly once');
  });

  it('fails closed on malformed output or YDC errors; never invokes Gemini text', async () => {
    const malformed = createAnalyzer({ output: { content: { summary: 'No legs' } } });
    await expect(malformed.analyzer.analyze([selection])).rejects.toThrow();
    const unavailable = createAnalyzer({ error: 'unavailable' }, 403);
    await expect(unavailable.analyzer.analyze([selection])).rejects.toThrow('You.com HTTP 403');
    expect(unavailable.fetchMock).toHaveBeenCalledTimes(1);
  });
});
