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
          evidenceQualityScore: { type: 'number' },
          statisticalSupport: { type: 'string', enum: ['supported', 'mixed', 'insufficient'] },
          conflictingEvidence: { type: 'boolean' },
          risk: { type: 'string', enum: ['lower', 'medium', 'higher'] },
          verdict: { type: 'string', enum: ['keep', 'caution', 'reject'] },
          reason: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string', format: 'uri' } },
          evidenceRetrievedAt: { type: 'string', format: 'date-time' },
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
} as const;

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

/**
 * Research models sometimes return fractions (0.73) despite a 0–100 prompt.
 * Never display 0.73 as 1/100. Detect a *consistent* fractional scale across
 * the complete response; fail closed on mixed or indeterminate scales.
 * Scores measure stated evidence quality, not outcome probability.
 */
export function normalizeResearchScores(values: number[]): number[] {
  if (
    !values.length ||
    values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)
  ) {
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

const isPredictionOrBettingSource = (value: string): boolean => {
  const host = new URL(value).hostname.toLowerCase();
  return /(?:sportybet|bet365|betway|stake|oddschecker|predictz|forebet|tips\.gg|bettingexpert)/i.test(
    host,
  );
};

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
        'IMPORTANT: evidenceQualityScore MUST be 0 to 100, e.g. 65 (NOT 0.65), and is NOT the probability of winning.',
        'Keep evidence quality, statisticalSupport, risk and verdict separate. A keep verdict requires supported statistics, no unresolved conflict, and traceable non-betting sourceUrls.',
        'Set evidenceRetrievedAt to the ISO timestamp when the cited evidence was retrieved. Current claims older than 24 hours must not receive keep.',
        'Use conservative evidence-quality scores when structured team statistics are missing. The score is not a betting prediction or a success rate.',
        'Mark ambiguous, inconsistent, inactive, unusual or high-odds selections caution or reject. Be explicit about missing evidence.',
        'Do not claim that any outcome is safe or guaranteed. Keep reasons concise and return only the structured schema.',
        JSON.stringify(input),
      ].join('\n'),
      outputSchema,
    );
    const content = response.output.content;
    const parsed = analysisSchema.parse(
      typeof content === 'string' ? JSON.parse(content) : content,
    );
    const indices = new Set(parsed.selections.map((item) => item.index));
    if (
      parsed.selections.length !== selections.length ||
      indices.size !== selections.length ||
      parsed.selections.some((item) => item.index > selections.length)
    ) {
      throw new Error('You.com analysis did not cover every selection exactly once.');
    }
    const scores = normalizeResearchScores(
      parsed.selections.map((item) => item.evidenceQualityScore),
    );
    const now = Date.now();
    for (const item of parsed.selections) {
      const stale = now - new Date(item.evidenceRetrievedAt).getTime() > 24 * 60 * 60_000;
      if (
        item.verdict === 'keep' &&
        (item.statisticalSupport !== 'supported' ||
          item.conflictingEvidence ||
          item.sourceUrls.length === 0 ||
          stale ||
          item.sourceUrls.every(isPredictionOrBettingSource))
      ) {
        throw new Error('You.com returned an unsupported or stale keep recommendation.');
      }
    }
    return {
      ...parsed,
      selections: parsed.selections.map((item, index) => ({
        ...item,
        // These are bounded, normalized evidence-quality labels, not calibrated win probabilities.
        evidenceQualityScore: scores[index]!,
        confidence: scores[index]!,
      })),
      model: 'you-research-standard',
      analyzedAt: new Date().toISOString(),
    };
  }
}
