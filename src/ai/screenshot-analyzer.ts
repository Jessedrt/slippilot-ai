import type { SportyBetProvider } from '../sportybet/contracts.js';
import { nameSimilarity } from '../sportybet/mapper.js';
import {
  normalizeScreenshotExtraction,
  type ScreenshotExtraction,
} from './screenshot-normalizer.js';

export interface ScreenshotAnalyzer {
  analyze(image: Uint8Array, mimeType: string): Promise<ScreenshotExtraction>;
}

interface GeminiScreenshotAnalyzerOptions {
  apiKey: string;
  sportyBet: SportyBetProvider;
  model?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class GeminiScreenshotAnalyzer implements ScreenshotAnalyzer {
  private readonly model: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GeminiScreenshotAnalyzerOptions) {
    this.model = options.model ?? 'gemini-3.6-flash';
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async analyze(image: Uint8Array, mimeType: string): Promise<ScreenshotExtraction> {
    const response = await this.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Extract every visible sports fixture or slip row. Return teams, competition, market, selection, decimal odds, match time, visible booking codes, a 0-1 confidence, and uncertain field names. Do not invent hidden text.',
                },
                { inlineData: { mimeType, data: Buffer.from(image).toString('base64') } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                items: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      homeTeam: { type: 'STRING' },
                      awayTeam: { type: 'STRING' },
                      competition: { type: 'STRING' },
                      market: { type: 'STRING' },
                      selection: { type: 'STRING' },
                      odds: { type: 'NUMBER' },
                      matchTime: { type: 'STRING' },
                      confidence: { type: 'NUMBER' },
                      uncertainFields: { type: 'ARRAY', items: { type: 'STRING' } },
                    },
                    required: ['homeTeam', 'awayTeam', 'confidence', 'uncertainFields'],
                  },
                },
                bookingCodes: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['items', 'bookingCodes'],
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) throw new Error(`Gemini vision failed with HTTP ${response.status}.`);
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (!text) throw new Error('Gemini vision returned no extraction.');
    return this.normalizeTeams(normalizeScreenshotExtraction(JSON.parse(text)));
  }

  private async normalizeTeams(extraction: ScreenshotExtraction): Promise<ScreenshotExtraction> {
    const eventGroups = await Promise.allSettled([
      this.options.sportyBet.listEvents('football'),
      this.options.sportyBet.listEvents('basketball'),
    ]);
    const events = eventGroups.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    return {
      ...extraction,
      items: extraction.items.map((item) => {
        const match = events
          .map((event) => ({
            event,
            score: Math.max(
              (nameSimilarity(item.homeTeam, event.homeTeam) +
                nameSimilarity(item.awayTeam, event.awayTeam)) /
                2,
              (nameSimilarity(item.homeTeam, event.awayTeam) +
                nameSimilarity(item.awayTeam, event.homeTeam)) /
                2,
            ),
          }))
          .sort((left, right) => right.score - left.score)[0];
        if (!match || match.score < 0.72) {
          return {
            ...item,
            uncertainFields: [...new Set([...item.uncertainFields, 'team normalization'])],
          };
        }
        return {
          ...item,
          homeTeam: match.event.homeTeam,
          awayTeam: match.event.awayTeam,
          confidence: Math.min(1, (item.confidence + match.score) / 2),
        };
      }),
    };
  }
}

export class DisabledScreenshotAnalyzer implements ScreenshotAnalyzer {
  analyze(): Promise<ScreenshotExtraction> {
    return Promise.reject(new Error('Vision analysis is not configured.'));
  }
}
