import { describe, expect, it, vi } from 'vitest';
import { GeminiSlipAnalyzer } from '../src/ai/slip-analyzer.js';
import type { CandidateSelection } from '../src/types/domain.js';

const selection: CandidateSelection = {
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

describe('GeminiSlipAnalyzer', () => {
  it('returns validated analysis covering every selection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: 'Moderate market risk.',
                      selections: [
                        {
                          index: 1,
                          confidence: 61,
                          risk: 'medium',
                          verdict: 'caution',
                          reason: 'The total requires a relatively high scoring game.',
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
      ),
    );
    const result = await new GeminiSlipAnalyzer({ apiKey: 'secret', fetch: fetchMock }).analyze([
      selection,
    ]);
    expect(result.selections[0]).toMatchObject({ index: 1, verdict: 'caution' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-goog-api-key': 'secret' });
  });

  it('fails closed when the model omits a selection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: 'Incomplete.',
                      selections: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(
      new GeminiSlipAnalyzer({ apiKey: 'secret', fetch: fetchMock }).analyze([selection]),
    ).rejects.toThrow('did not cover every selection');
  });

  it('fails over to a secondary key when the primary key is rate limited', async () => {
    const success = new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Reviewed.',
                    selections: [
                      {
                        index: 1,
                        confidence: 70,
                        risk: 'lower',
                        verdict: 'keep',
                        reason: 'Supported over market.',
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(success);
    await expect(
      new GeminiSlipAnalyzer({
        apiKey: 'primary',
        apiKeys: ['secondary'],
        fetch: fetchMock,
      }).analyze([selection]),
    ).resolves.toMatchObject({ summary: 'Reviewed.' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'x-goog-api-key': 'secondary',
    });
  });
});
