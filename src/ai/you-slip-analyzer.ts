import { z } from 'zod';
import type { CandidateSelection } from '../types/domain.js';
import type { YouClient } from '../you/client.js';
import type { SlipAnalysis, SlipAnalyzer } from './slip-analyzer.js';

// You.com Research supports structured output with standard effort (not lite).
// All properties must be required and objects must reject additional properties.
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
      confidence: z.number().min(0).max(99),
      risk: z.enum(['lower', 'medium', 'higher']),
      verdict: z.enum(['keep', 'caution', 'reject']),
      reason: z.string().min(1).max(300),
    }),
  ),
});

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
        'The confidence field is an approximate evidence/market-quality indicator, NOT an estimated probability of winning; use conservative values when structured team statistics are missing.',
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
    return {
      ...parsed,
      selections: parsed.selections.map((item) => ({
        ...item,
        // Numbers are quality labels, not calibrated win probabilities.
        confidence: Math.min(item.confidence, 75),
      })),
      model: 'you-research-standard',
      analyzedAt: new Date().toISOString(),
    };
  }
}
