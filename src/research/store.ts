import type { PrismaClient } from '@prisma/client';
import type { SportsResearchResult } from '../you/types.js';

export interface ResearchSnapshotStore {
  save(fixtureId: string, query: string, result: SportsResearchResult): Promise<void>;
}

export class PrismaResearchSnapshotStore implements ResearchSnapshotStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(fixtureId: string, query: string, result: SportsResearchResult): Promise<void> {
    await this.prisma.researchSnapshot.create({
      data: {
        fixtureId,
        query,
        summary: result.summary,
        freshness: result.freshness,
        confidence: result.confidence,
        searchedAt: result.searchedAt,
        rawMetadata: { conflicting: result.conflicting, status: result.status },
        sources: {
          create: result.sources.map((source) => ({
            sourceTitle: source.title,
            sourceUrl: source.url,
            publisher: source.publisher,
            ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
            confidence: source.qualityScore * 100,
            rawMetadata: { quality: source.quality },
          })),
        },
      },
    });
  }
}
