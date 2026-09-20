import type { NormalizedMarket } from '../types/domain.js';

/**
 * User-configured basketball picking preference: never auto-pick handicap or
 * spread markets, including quarter/half spreads. Inspect both the provider's
 * name and category since some feeds label these differently. This does not
 * prohibit totals, winners, player props, or handicaps in other sports.
 */
export function isBasketballHandicapMarket(
  market: Pick<NormalizedMarket, 'marketName' | 'selectionName'> &
    Partial<Pick<NormalizedMarket, 'category'>>,
): boolean {
  const label = `${market.marketName} ${market.category ?? ''}`;
  return /\b(?:handicap|spread|hcp)\b/i.test(label) ||
    /^(?:home|away|team\s*[12]|[12])\s*[+-]\s*\d+(?:\.\d+)?\b/i.test(market.selectionName);
}

/** @deprecated Historical export retained for existing callers. */
export function isAllowedBasketballOverMarket(
  market: Pick<NormalizedMarket, 'marketName' | 'selectionName'> &
    Partial<Pick<NormalizedMarket, 'category'>>,
): boolean {
  return !isBasketballHandicapMarket(market);
}
