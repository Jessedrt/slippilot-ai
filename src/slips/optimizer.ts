import type { CandidateSelection, RiskMode } from '../types/domain.js';

export interface OptimizationRequest {
  candidates: CandidateSelection[];
  targetOdds?: number;
  minimumOdds?: number;
  maximumOdds?: number;
  gameCount?: number;
  minimumConfidence?: number;
  riskPreference?: RiskMode;
  beamWidth?: number;
}

export interface OptimizationResult {
  selections: CandidateSelection[];
  combinedOdds: number;
  targetDelta?: number;
}

export const combinedOdds = (items: Array<Pick<CandidateSelection, 'odds'>>): number =>
  Math.round(items.reduce((product, item) => product * item.odds, 1) * 100) / 100;

interface BeamState {
  selections: CandidateSelection[];
  odds: number;
  score: number;
  fixtureIds: Set<string>;
}

export class SlipOptimizer {
  optimize(request: OptimizationRequest): OptimizationResult {
    const target = request.targetOdds ?? request.minimumOdds ?? 2;
    const count = request.gameCount ?? Math.min(5, request.candidates.length);
    const minConfidence = request.minimumConfidence ?? 0;
    const width = request.beamWidth ?? 100;
    const candidates = request.candidates
      .filter((item) => item.status === 'active' && item.modelProbability >= minConfidence)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);
    let beam: BeamState[] = [{ selections: [], odds: 1, score: 0, fixtureIds: new Set() }];

    for (const candidate of candidates) {
      const additions = beam
        .filter(
          (state) => state.selections.length < count && !state.fixtureIds.has(candidate.fixture.id),
        )
        .map((state) => {
          const selections = [...state.selections, candidate];
          const odds = state.odds * candidate.odds;
          const distance = Math.abs(Math.log(Math.max(odds, 1.001) / target));
          const riskPenalty = { lower: 0, medium: 0.4, higher: 1 }[candidate.riskLevel];
          const dataPenalty = { high: 0, medium: 0.25, low: 0.7 }[candidate.dataQuality];
          const modePenalty =
            request.riskPreference === 'conservative'
              ? riskPenalty * 2
              : request.riskPreference === 'aggressive'
                ? riskPenalty * 0.4
                : riskPenalty;
          return {
            selections,
            odds,
            score:
              selections.reduce((sum, item) => sum + item.confidenceScore, 0) -
              distance * 12 -
              modePenalty -
              dataPenalty,
            fixtureIds: new Set([...state.fixtureIds, candidate.fixture.id]),
          };
        });
      beam = [...beam, ...additions].sort((a, b) => b.score - a.score).slice(0, width);
    }

    const eligible = beam.filter((state) => {
      if (state.selections.length !== count) return false;
      if (request.minimumOdds && state.odds < request.minimumOdds) return false;
      if (request.maximumOdds && state.odds > request.maximumOdds) return false;
      return true;
    });
    const best = (eligible.length ? eligible : beam)
      .filter((state) => state.selections.length > 0)
      .sort((a, b) => {
        const countPenaltyA = Math.abs(a.selections.length - count) * 20;
        const countPenaltyB = Math.abs(b.selections.length - count) * 20;
        return b.score - countPenaltyB - (a.score - countPenaltyA);
      })[0];
    if (!best) return { selections: [], combinedOdds: 1, targetDelta: Math.abs(target - 1) };
    const rounded = Math.round(best.odds * 100) / 100;
    return {
      selections: best.selections,
      combinedOdds: rounded,
      ...(request.targetOdds !== undefined
        ? { targetDelta: Math.abs(rounded - request.targetOdds) }
        : {}),
    };
  }
}
