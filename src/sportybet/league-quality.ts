import type { Sport } from '../types/domain.js';

/**
 * AUREX's default fixture filter uses competition metadata, not an invented
 * probability or a claim that a team is good/bad. A missing or unfamiliar league
 * name is NOT evidence that a real competition is amateur: leave it eligible.
 * Keep this separate from the market filter so all active markets remain open.
 */
export type LeagueExclusionReason =
  | 'Friendly or exhibition competition'
  | 'Youth, reserve or developmental competition'
  | 'Regional, amateur or school competition'
  | 'Lower-tier competition'
  | 'Virtual or simulated competition';

const exclusions: ReadonlyArray<{ pattern: RegExp; reason: LeagueExclusionReason }> = [
  {
    pattern: /\b(?:friendlies|friendly|exhibition|pre[ -]?season|training match|test match|warm[ -]?up)\b/i,
    reason: 'Friendly or exhibition competition',
  },
  {
    pattern: /\b(?:reserves?|reserve league|youth|junior|academy|development(?:al)?|u[ -]?(?:1[5-9]|2[0-3])|under[ -]?(?:1[5-9]|2[0-3]))\b/i,
    reason: 'Youth, reserve or developmental competition',
  },
  {
    pattern: /\b(?:amateur|non[ -]?league|regional|county|district|municipal|provincial|grassroots|state (?:league|cup)|high[ -]?school|school league|university league)\b/i,
    reason: 'Regional, amateur or school competition',
  },
  {
    pattern: /\b(?:(?:third|fourth|fifth|3rd|4th|5th) (?:division|league)|division[ -]?(?:3|4|5|iii|iv|v)|serie [cd]|tercera (?:division|federaci[oó]n)|regionalliga|oberliga|conference (?:north|south)|g[ -]?league)\b/i,
    reason: 'Lower-tier competition',
  },
  {
    pattern: /\b(?:esports?|e[ -]?(?:soccer|football|basketball)|virtual|simulated|cyber (?:football|basketball))\b/i,
    reason: 'Virtual or simulated competition',
  },
];

/** Returns null when the competition remains eligible for pre-match discovery. */
export function leagueExclusionReason(
  sport: Sport,
  league: string | undefined,
): LeagueExclusionReason | null {
  if (sport !== 'football' && sport !== 'basketball') return null;
  const name = league?.trim();
  if (!name) return null; // Do not invent a league classification from missing metadata.
  return exclusions.find(({ pattern }) => pattern.test(name))?.reason ?? null;
}
