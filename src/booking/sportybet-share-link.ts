/** SportyBet Nigeria's shareCode URL opens a generated code for review, without placing a bet. */
export function sportyBetShareUrl(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,20}$/.test(normalized)) return null;
  return `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(normalized)}`;
}
