import { z } from 'zod';

export const intentSchema = z.object({
  action: z.enum([
    'discover',
    'analyze',
    'explore_markets',
    'modify_slip',
    'split_slip',
    'read_code',
    'read_screenshot',
    'generate_code',
    'research',
    'show_sources',
    'unknown',
  ]),
  sport: z.enum(['football', 'basketball']).optional(),
  gameCount: z.number().int().min(1).max(30).optional(),
  minimumGameCount: z.number().int().min(1).max(30).optional(),
  maximumGameCount: z.number().int().min(1).max(30).optional(),
  targetOdds: z.number().finite().min(1.01).optional(),
  minimumOdds: z.number().min(1.01).optional(),
  maximumOdds: z.number().min(1.01).optional(),
  minimumConfidence: z.number().min(0).max(100).optional(),
  league: z.string().max(100).optional(),
  date: z.string().max(40).optional(),
  marketPreferences: z.array(z.string().max(80)).max(20).default([]),
  riskPreference: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  existingSlipReference: z.string().max(80).optional(),
  bookingCode: z.string().min(4).max(40).optional(),
  screenshotIntent: z.boolean().default(false),
  modification: z
    .object({
      operation: z.enum(['remove', 'replace', 'keep', 'convert', 'optimize']),
      indices: z.array(z.number().int().positive()).default([]),
      count: z.number().int().positive().optional(),
      confidenceThreshold: z.number().min(0).max(100).optional(),
      targetSport: z.enum(['football', 'basketball']).optional(),
      targetMarketCategory: z.string().max(80).optional(),
      startsAfterHour: z.number().int().min(0).max(23).optional(),
      description: z.string().max(300).optional(),
    })
    .optional(),
  splitCount: z.number().int().min(2).max(10).optional(),
});

export type ParsedIntent = z.infer<typeof intentSchema>;

export interface StructuredIntentProvider {
  parse(text: string): Promise<unknown>;
}

