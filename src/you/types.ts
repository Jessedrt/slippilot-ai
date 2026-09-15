import { z } from 'zod';

export const youSearchItemSchema = z.object({
  url: z.string().url(),
  title: z.string().default('Untitled'),
  description: z.string().optional(),
  snippets: z.array(z.string()).default([]),
  page_age: z.string().optional(),
}).passthrough();

export const youSearchResponseSchema = z.object({
  results: z.object({
    web: z.array(youSearchItemSchema).default([]),
    news: z.array(youSearchItemSchema).default([]),
  }).default({ web: [], news: [] }),
  metadata: z.object({ query: z.string().optional(), search_uuid: z.string().optional() }).passthrough().optional(),
});

export const youAnswerResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ source: z.string().url(), excerpts: z.array(z.string()).default([]) })).default([]),
  results: z.object({ web: z.array(youSearchItemSchema).default([]) }).optional(),
});

export const youResearchResponseSchema = z.object({
  output: z.object({
    content: z.string(),
    content_type: z.string().optional(),
    sources: z.array(youSearchItemSchema).default([]),
  }),
});

export const youContentSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  markdown: z.string().nullish(),
  html: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const youContentsResponseSchema = z.array(youContentSchema);

export type YouSearchItem = z.infer<typeof youSearchItemSchema>;
export type YouSearchResponse = z.infer<typeof youSearchResponseSchema>;
export type YouAnswerResponse = z.infer<typeof youAnswerResponseSchema>;
export type YouResearchResponse = z.infer<typeof youResearchResponseSchema>;
export type YouContent = z.infer<typeof youContentSchema>;

export interface ResearchSource {
  title: string;
  url: string;
  publisher: string;
  publishedAt?: Date;
  snippet?: string;
  quality: 'high' | 'medium' | 'low';
  qualityScore: number;
}

export interface SportsResearchResult {
  summary: string;
  sources: ResearchSource[];
  freshness: 'breaking' | 'recent' | 'unknown';
  confidence: number;
  searchedAt: Date;
  conflicting: boolean;
  status: 'available' | 'unavailable' | 'skipped';
}
