import type { NormalizedMarket } from '../types/domain.js';

/**
 * @deprecated Compatibility export for callers of the former six-category
 * basketball Over allowlist. That product restriction has been removed:
 * every basketball market category and outcome (including Under, winner,
 * handicap/spread, later periods and player props) is eligible for discovery.
 * The caller must still check the provider's active status, valid odds,
 * event timing and booking-code verification before using a selection.
 */
export function isAllowedBasketballOverMarket(
  _market: Pick<NormalizedMarket, 'marketName' | 'selectionName'>,
): boolean {
  void _market;
  return true;
}
