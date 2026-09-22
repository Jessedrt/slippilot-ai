import { z } from 'zod';
import type { CandidateSelection } from '../types/domain.js';

const analysisSchema = z
  .object({
    summary: z.string().min(1).max(600),
    selections: z.array(
      z
        .object({
          index: z.number().int().positive(),
          evidenceQualityScore: z.number().finite().min(0).max(100),
          statisticalSupport: z.enum(['supported', 'mixed', 'insufficient']),
          conflictingEvidence: z.boolean(),
          risk: z.enum(['lower', 'medium', 'higher']),
          verdict: z.enum(['keep', 'caution', 'reject']),
          reason: z.string().min(1).max(300),
          sourceUrls: z.array(z.string().url()).max(12),
          evidenceRetrievedAt: z.string().datetime(),
        })
        .strict(),
    ),
  })
  .strict();

export interface SlipSelectionReview {
  index: number;
  /** Backwards-compatible display alias. It is evidence quality, not win probability. */
  confidence: number;
  evidenceQualityScore?: number;
  statisticalSupport?: 'supported' | 'mixed' | 'insufficient';
  conflictingEvidence?: boolean;
  risk: 'lower' | 'medium' | 'higher';
  verdict: 'keep' | 'caution' | 'reject';
  reason: string;
  sourceUrls?: string[];
  evidenceRetrievedAt?: string;
}
export type SlipAnalysis = Omit<z.infer<typeof analysisSchema>, 'selections'> & {
  selections: SlipSelectionReview[];
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
        options.model ?? 'gemini-3.5-flash',
        ...(options.models ?? ['gemini-3.1-flash-lite', 'gemini-3.6-flash']),
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
                'evidenceQualityScore measures source/evidence quality, never probability. statisticalSupport is separate from risk and verdict.',
                'Gemini has no independent sources in this request, so do not mark a selection keep/supported. Use caution or reject with insufficient support and an empty sourceUrls array.',
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
                  evidenceQualityScore: { type: 'NUMBER', minimum: 0, maximum: 100 },
                  statisticalSupport: {
                    type: 'STRING',
                    enum: ['supported', 'mixed', 'insufficient'],
                  },
                  conflictingEvidence: { type: 'BOOLEAN' },
                  risk: { type: 'STRING', enum: ['lower', 'medium', 'higher'] },
                  verdict: { type: 'STRING', enum: ['keep', 'caution', 'reject'] },
                  reason: { type: 'STRING' },
                  sourceUrls: { type: 'ARRAY', items: { type: 'STRING' } },
                  evidenceRetrievedAt: { type: 'STRING' },
                },
                required: [
                  'index',
                  'evidenceQualityScore',
                  'statisticalSupport',
                  'conflictingEvidence',
                  'risk',
                  'verdict',
                  'reason',
                  'sourceUrls',
                  'evidenceRetrievedAt',
                ],
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
    let attemptCount = 0;
    // A 404 can be specific to the model/key combination. Try another model instead of
    // spending the entire attempt budget on the same missing model with multiple keys.
    modelLoop: for (const model of this.models) {
      for (const apiKey of this.apiKeys.slice(0, 2)) {
        if (attemptCount >= 4) break modelLoop;
        attemptCount += 1;
        let candidate: Response;
        try {
          candidate = await this.fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
              body,
              signal: AbortSignal.timeout(this.timeoutMs),
            },
          );
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Gemini analysis failed.');
          continue;
        }
        if (candidate.ok) {
          response = candidate;
          usedModel = model;
          break modelLoop;
        }
        lastError = new Error(`Gemini analysis failed with HTTP ${candidate.status}.`);
        if (candidate.status === 400 || candidate.status === 422) throw lastError;
        if (candidate.status === 404) break; // Try a different model immediately.
        if ([401, 403, 429].includes(candidate.status)) continue; // Try another key.
        break; // Retryable server failures can use another model, not the same POST.
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
    return {
      ...parsed,
      selections: parsed.selections.map((item) => ({
        ...item,
        confidence: item.evidenceQualityScore,
      })),
      model: usedModel!,
      analyzedAt: new Date().toISOString(),
    };
  }
}

export class DisabledSlipAnalyzer implements SlipAnalyzer {
  analyze(): Promise<SlipAnalysis> {
    return Promise.reject(new Error('AI slip analysis is not configured.'));
  }
}
