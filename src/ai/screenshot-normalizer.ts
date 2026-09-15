import { z } from 'zod';

const extractedItemSchema = z.object({
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  competition: z.string().optional(),
  market: z.string().optional(),
  selection: z.string().optional(),
  odds: z.number().positive().optional(),
  matchTime: z.string().optional(),
  confidence: z.number().min(0).max(1),
  uncertainFields: z.array(z.string()).default([]),
});

export const screenshotExtractionSchema = z.object({
  items: z.array(extractedItemSchema).max(50),
  bookingCodes: z.array(z.string().min(4).max(40)).default([]),
});

export type ScreenshotExtraction = z.infer<typeof screenshotExtractionSchema>;

export function normalizeScreenshotExtraction(raw: unknown): ScreenshotExtraction {
  const parsed = screenshotExtractionSchema.parse(raw);
  return {
    ...parsed,
    items: parsed.items.map((item) => ({
      ...item,
      homeTeam: item.homeTeam.trim().replace(/\s+/g, ' '),
      awayTeam: item.awayTeam.trim().replace(/\s+/g, ' '),
      uncertainFields: [
        ...new Set([
          ...item.uncertainFields,
          ...(item.confidence < 0.7 ? ['teams'] : []),
          ...(!item.market ? ['market'] : []),
          ...(!item.selection ? ['selection'] : []),
        ]),
      ],
    })),
  };
}
