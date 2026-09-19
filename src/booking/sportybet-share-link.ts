/** SportyBet's published booking-code link opens a code for review, without placing a wager. */
export function sportyBetShareUrl(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(normalized)) return null;
  return `https://www.sportybet.com/?shareCode=${encodeURIComponent(normalized)}`;
}
