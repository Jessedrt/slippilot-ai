import { z } from 'zod';
import type { CandidateSelection } from '../types/domain.js';

const analysisSchema = z.object({
  summary: z.string().min(1).max(600),
  selections: z.array(
    z.object({
      index: z.number().int().positive(),
      confidence: z.number().min(0).max(99),
      risk: z.enum(['lower', 'medium', 'higher']),
      verdict: z.enum(['keep', 'caution', 'reject']),
      reason: z.string().min(1).max(300),
    }),
  ),
});

export type SlipAnalysis = z.infer<typeof analysisSchema> & {
  model: string;
  analyzedAt: string;
};

export interface SlipAnalyzer {
  analyze(selections: CandidateSelection[]): Promise<SlipAnalysis>;
}

interface GeminiSlipAnalyzerOptions {
  apiKey: string;
  apiKeys?: string[];
  model?: string;
  models?: string[];
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class GeminiSlipAnalyzer implements SlipAnalyzer {
  private readonly apiKeys: string[];
  private readonly models: string[];
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GeminiSlipAnalyzerOptions) {
    this.apiKeys = [...new Set([options.apiKey, ...(options.apiKeys ?? [])].filter(Boolean))];
    this.models = [
      ...new Set([
        options.model ?? 'gemini-3.6-flash',
        ...(options.models ?? ['gemini-2.5-flash-lite']),
      ]),
    ];
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 25_000;
  }

  async analyze(selections: CandidateSelection[]): Promise<SlipAnalysis> {
    if (selections.length === 0) throw new Error('Cannot analyze an empty slip.');
    const input = selections.map((selection, index) => ({
      index: index + 1,
      fixture: `${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam}`,
      startsAt: selection.fixture.startsAt.toISOString(),
      market: selection.marketName,
      pick: selection.selectionName,
      odds: selection.odds,
    }));
    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                'Act as a cautious sports-market risk analyst. Analyze every supplied selection before a booking code can be created.',
                'Use only the fixture, start time, market, selection, and live odds supplied. Never invent form, injuries, lineups, results, or certainty.',
                'Confidence measures market/risk quality, not a guaranteed win. Mark fragile, unusual, ambiguous, or high-odds markets as caution or reject.',
                'Return exactly one item for each input index.',
                JSON.stringify(input),
              ].join('\n'),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING' },
            selections: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  index: { type: 'INTEGER' },
                  confidence: { type: 'NUMBER', minimum: 0, maximum: 99 },
                  risk: { type: 'STRING', enum: ['lower', 'medium', 'higher'] },
                  verdict: { type: 'STRING', enum: ['keep', 'caution', 'reject'] },
                  reason: { type: 'STRING' },
                },
                required: ['index', 'confidence', 'risk', 'verdict', 'reason'],
              },
            },
          },
          required: ['summary', 'selections'],
        },
      },
    });
    let response: Response | undefined;
    let usedModel: string | undefined;
    let lastError: Error | undefined;
    const attempts = [
      ...this.apiKeys.map((apiKey) => ({ apiKey, model: this.models[0]! })),
      ...this.models.slice(1).map((model) => ({ apiKey: this.apiKeys[0]!, model })),
    ].slice(0, 3);
    for (const [index, attempt] of attempts.entries()) {
      try {
        const candidate = await this.fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(attempt.model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': attempt.apiKey },
            body,
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );
        if (candidate.ok) {
          response = candidate;
          usedModel = attempt.model;
          break;
        }
        lastError = new Error(`Gemini analysis failed with HTTP ${candidate.status}.`);
        if (index === attempts.length - 1) throw lastError;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Gemini analysis failed.');
        if (index === attempts.length - 1) throw lastError;
      }
    }
    if (!response) throw lastError ?? new Error('Gemini analysis failed.');
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (!text) throw new Error('Gemini returned no analysis.');
    const parsed = analysisSchema.parse(JSON.parse(text));
    const indices = new Set(parsed.selections.map((item) => item.index));
    if (
      parsed.selections.length !== selections.length ||
      indices.size !== selections.length ||
      parsed.selections.some((item) => item.index > selections.length)
    ) {
      throw new Error('Gemini analysis did not cover every selection.');
    }
    return { ...parsed, model: usedModel!, analyzedAt: new Date().toISOString() };
  }
}

export class DisabledSlipAnalyzer implements SlipAnalyzer {
  analyze(): Promise<SlipAnalysis> {
    return Promise.reject(new Error('AI slip analysis is not configured.'));
  }
}
