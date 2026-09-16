import { z } from 'zod';
import type { CandidateSelection } from '../types/domain.js';
import type { YouClient } from '../you/client.js';
import type { SlipAnalysis, SlipAnalyzer } from './slip-analyzer.js';

// You.com Research structured output. Every property is required and unknown fields are rejected.
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    selections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          confidence: { type: 'number' },
          risk: { type: 'string', enum: ['lower', 'medium', 'higher'] },
          verdict: { type: 'string', enum: ['keep', 'caution', 'reject'] },
          reason: { type: 'string' },
        },
        required: ['index', 'confidence', 'risk', 'verdict', 'reason'],
      },
    },
  },
  required: ['summary', 'selections'],
} as const;

const analysisSchema = z.object({
  summary: z.string().min(1).max(600),
  selections: z.array(
    z.object({
      index: z.number().int().positive(),
      confidence: z.number().finite().min(0).max(100),
      risk: z.enum(['lower', 'medium', 'higher']),
      verdict: z.enum(['keep', 'caution', 'reject']),
      reason: z.string().min(1).max(300),
    }),
  ),
});

/**
 * Research models sometimes return fractions (0.73) despite a 0–100 prompt.
 * Never display 0.73 as 1/100. Detect a *consistent* fractional scale across
 * the complete response; fail closed on mixed or indeterminate scales.
 * Scores measure stated evidence quality, not outcome probability.
 */
export function normalizeResearchScores(values: number[]): number[] {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error('AI returned an invalid quality score. Rebuild the slip.');
  }
  const fractional = values.some((value) => value > 0 && value < 1);
  const percentage = values.some((value) => value > 1);
  if (fractional && percentage) {
    throw new Error('AI returned mixed quality-score scales. Rebuild the slip.');
  }
  if (!fractional && !percentage && values.every((value) => value === 1)) {
    throw new Error('AI returned an ambiguous quality-score scale. Rebuild the slip.');
  }
  const scale = fractional ? 100 : 1;
  return values.map((value) => Math.min(75, Math.round(value * scale)));
}

export class YouSlipAnalyzer implements SlipAnalyzer {
  constructor(private readonly client: Pick<YouClient, 'structuredResearch'>) {}

  async analyze(selections: CandidateSelection[]): Promise<SlipAnalysis> {
    if (!selections.length) throw new Error('Cannot analyze an empty slip.');
    const input = selections.map((selection, index) => ({
      index: index + 1,
      sport: selection.sport,
      fixture: `${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam}`,
      startsAt: selection.fixture.startsAt.toISOString(),
      market: selection.marketName,
      pick: selection.selectionName,
      odds: selection.odds,
      dataQuality: selection.dataQuality,
    }));
    const response = await this.client.structuredResearch(
      [
        'Review the following live bookmaker selections as a cautious sports-market risk analyst.',
        'Return EXACTLY one selection per input index, in the same order, using the required JSON schema.',
        'Only use the provided fixtures, kickoff times, markets, selections and odds, plus independently sourced and directly relevant recent facts if available.',
        'Do not invent injuries, lineups, results, probabilities, or certainty. If a claim cannot be verified, do not assert it.',
        'IMPORTANT: confidence MUST be a number on a 0 to 100 scale, e.g. 65 (NOT 0.65), representing evidence/market quality, NOT the probability of winning. Do not use percentages in the number itself.',
        'Use conservative evidence-quality scores when structured team statistics are missing. The score is not a betting prediction or a success rate.',
        'Mark ambiguous, inconsistent, inactive, unusual or high-odds selections caution or reject. Be explicit about missing evidence.',
        'Do not claim that any outcome is safe or guaranteed. Keep reasons concise and return only the structured schema.',
        JSON.stringify(input),
      ].join('\n'),
      outputSchema,
    );
    const content = response.output.content;
    const parsed = analysisSchema.parse(typeof content === 'string' ? JSON.parse(content) : content);
    const indices = new Set(parsed.selections.map((item) => item.index));
    if (
      parsed.selections.length !== selections.length ||
      indices.size !== selections.length ||
      parsed.selections.some((item) => item.index > selections.length)
    ) {
      throw new Error('You.com analysis did not cover every selection exactly once.');
    }
    const scores = normalizeResearchScores(parsed.selections.map((item) => item.confidence));
    return {
      ...parsed,
      selections: parsed.selections.map((item, index) => ({
        ...item,
        // These are bounded, normalized evidence-quality labels, not calibrated win probabilities.
        confidence: scores[index]!,
      })),
      model: 'you-research-standard',
      analyzedAt: new Date().toISOString(),
    };
  }
}
