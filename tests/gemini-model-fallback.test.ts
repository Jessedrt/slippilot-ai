import { describe, expect, it, vi } from 'vitest';
import { GeminiSlipAnalyzer } from '../src/ai/slip-analyzer.js';
import type { CandidateSelection } from '../src/types/domain.js';

const candidate: CandidateSelection = {
  providerMarketId: 'm1',
  providerSelectionId: 's1',
  eventId: 'sr:match:1',
  sport: 'basketball',
  category: 'total',
  marketName: 'Total points',
  selectionName: 'Over 199.5',
  odds: 1.8,
  status: 'active',
  lastUpdated: new Date(),
  fixture: {
    id: 'sr:match:1',
    sport: 'basketball',
    league: 'SportyBet',
    homeTeam: 'Home',
    awayTeam: 'Away',
    startsAt: new Date(Date.now() + 3_600_000),
    status: 'scheduled',
  },
  modelProbability: 55,
  confidenceScore: 55,
  dataQuality: 'medium',
  riskLevel: 'medium',
  reasoning: [],
};

const successfulResponse = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: 'Reviewed from live odds only.',
                  selections: [
                    {
                      index: 1,
                      confidence: 60,
                      risk: 'medium',
                      verdict: 'caution',
                      reason: 'Outcome uncertain.',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }),
    { status: 200 },
  );

describe('Gemini model fallback', () => {
  it('changes model after 404 instead of repeating the unavailable model with another key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(successfulResponse());
    const analyzer = new GeminiSlipAnalyzer({
      apiKey: 'primary',
      apiKeys: ['secondary'],
      model: 'unavailable-model',
      models: ['available-model'],
      fetch: fetchMock,
    });
    await expect(analyzer.analyze([candidate])).resolves.toMatchObject({ model: 'available-model' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/unavailable-model:generateContent');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/available-model:generateContent');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'x-goog-api-key': 'primary',
    });
  });
});
