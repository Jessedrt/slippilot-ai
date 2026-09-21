// AI confidence is an evidence-quality score, NOT an outcome probability.
// Rank by the actual reviewed score before selecting whole, provider-backed legs.
const score = (pick) => Number.isFinite(pick?.confidence) ? pick.confidence : -1;
const riskWeight = { lower: 0, medium: 1, higher: 2 };
const rankByScore = (selections) => [...selections].sort((a, b) =>
  score(b) - score(a) ||
  (riskWeight[a.risk] ?? 3) - (riskWeight[b.risk] ?? 3) ||
  a.odds - b.odds);
const combinedOdds = (selections) => selections.reduce((total, pick) => total * pick.odds, 1);
function selectForTarget(selections, target) {
  if (!Number.isFinite(target) || target < 1.01) return { ok: false, reason: 'invalid_target' };
  const ranked = rankByScore(selections);
  if (!ranked.length) return { ok: false, reason: 'empty' };
  if (combinedOdds(ranked) <= target + 0.000001) {
    return { ok: true, selections: ranked, removed: 0, combinedOdds: combinedOdds(ranked) };
  }
  const chosen = [];
  let odds = 1;
  for (const pick of ranked) {
    if (odds * pick.odds <= target + 0.000001) {
      chosen.push(pick);
      odds *= pick.odds;
    }
  }
  if (!chosen.length) return { ok: false, reason: 'no_feasible_pick' };
  return { ok: true, selections: chosen, removed: ranked.length - chosen.length, combinedOdds: odds };
}
globalThis.AurexScoreTrim = Object.freeze({ rankByScore, selectForTarget, combinedOdds });
