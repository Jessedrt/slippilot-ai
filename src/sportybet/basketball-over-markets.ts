import type { NormalizedMarket } from '../types/domain.js';

/** Only six basketball totals categories can enter automatically generated slips. */
export function isAllowedBasketballOverMarket(
  market: Pick<NormalizedMarket, 'marketName' | 'selectionName'>,
): boolean {
  const selection = market.selectionName.trim().toLowerCase();
  if (!/^(?:over\s+|o\s*)(?:\d+(?:\.\d+)?|\d*\.\d+)\b/.test(selection)) return false;

  const name = market.marketName
    .trim()
    .toLowerCase()
    .replace(/\s*\((?:incl\.?\s*overtime|including overtime)\)\s*/g, ' ')
    .replace(/[–—:]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const periods = name.match(/\b(?:1st|first)\s+(?:half|quarter)\b/g) ?? [];
  if (periods.length > 1) return false;
  // Unknown periods or player props never silently become a full-game total.
  if (/\b(?:2nd|second|3rd|third|4th|fourth)\s+(?:half|quarter)\b|\b(?:q[1-4]|h[12]|period|player)\b/.test(name)) return false;

  const marketName = name
    .replace(/\b(?:1st|first)\s+(?:half|quarter)\b/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Full-time, first-half or first-quarter game total Over.
  const gameTotal = /^(?:over\s*\/\s*under|o\s*\/\s*u|total(?:\s+points?)?|game\s+total(?:\s+points?)?)$/.test(marketName);
  // Full-time, first-half or first-quarter individual team total Over.
  const teamTotal = /^(?:(?:home|away|competitor\s*[12])(?:\s+team)?\s+(?:over\s*\/\s*under|o\s*\/\s*u|total(?:\s+points?)?)|(?:over\s*\/\s*under|o\s*\/\s*u|total(?:\s+points?)?)\s+(?:home|away|competitor\s*[12])(?:\s+team)?)$/.test(marketName);
  return gameTotal || teamTotal;
}
