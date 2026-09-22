import { z } from 'zod';
import type { ApiSportsProduct } from './client.js';

const mappingSchema = z
  .object({
    competitions: z
      .array(
        z
          .object({
            product: z.enum(['football', 'basketball']),
            sportyBetName: z.string().min(1).max(160),
            apiSportsId: z.number().int().positive(),
          })
          .strict(),
      )
      .max(2_000)
      .default([]),
    teams: z
      .array(
        z
          .object({
            product: z.enum(['football', 'basketball']),
            sportyBetName: z.string().min(1).max(160),
            apiSportsId: z.number().int().positive(),
          })
          .strict(),
      )
      .max(20_000)
      .default([]),
  })
  .strict();

export type VerifiedFixtureMappings = z.infer<typeof mappingSchema>;

const key = (product: ApiSportsProduct, name: string) =>
  `${product}:${name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`;

/**
 * Mappings are operator-reviewed identities, not fuzzy aliases. The provider ID is
 * always checked against the candidate returned for the exact date and kickoff.
 */
export class VerifiedFixtureIdentityRegistry {
  private readonly competitions = new Map<string, number>();
  private readonly teams = new Map<string, number>();

  constructor(mappings: VerifiedFixtureMappings = { competitions: [], teams: [] }) {
    for (const mapping of mappings.competitions) {
      const mappingKey = key(mapping.product, mapping.sportyBetName);
      if (this.competitions.has(mappingKey))
        throw new Error('Duplicate verified API-Sports competition mapping.');
      this.competitions.set(mappingKey, mapping.apiSportsId);
    }
    for (const mapping of mappings.teams) {
      const mappingKey = key(mapping.product, mapping.sportyBetName);
      if (this.teams.has(mappingKey))
        throw new Error('Duplicate verified API-Sports team mapping.');
      this.teams.set(mappingKey, mapping.apiSportsId);
    }
  }

  competitionId(product: ApiSportsProduct, sportyBetName: string): number | undefined {
    return this.competitions.get(key(product, sportyBetName));
  }

  teamId(product: ApiSportsProduct, sportyBetName: string): number | undefined {
    return this.teams.get(key(product, sportyBetName));
  }

  counts(product: ApiSportsProduct): { competitions: number; teams: number } {
    const prefix = `${product}:`;
    return {
      competitions: [...this.competitions.keys()].filter((value) => value.startsWith(prefix))
        .length,
      teams: [...this.teams.keys()].filter((value) => value.startsWith(prefix)).length,
    };
  }
}

export function parseVerifiedFixtureMappings(value?: string): VerifiedFixtureMappings {
  if (!value?.trim()) return { competitions: [], teams: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('API_SPORTS_VERIFIED_MAPPINGS_JSON must contain valid JSON.');
  }
  return mappingSchema.parse(parsed);
}
