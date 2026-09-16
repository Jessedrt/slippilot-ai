import type { ParsedIntent } from '../ai/intent-schema.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, RiskMode, SlipDraft } from '../types/domain.js';
import { SlipOptimizer } from './optimizer.js';

export interface EditRequest {
  intent: ParsedIntent;
  rawText: string;
  sportyBet: SportyBetProvider;
}

const weakestFirst = (left: CandidateSelection, right: CandidateSelection) =>
  left.confidenceScore - right.confidenceScore || right.odds - left.odds;

function lagosHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'Africa/Lagos',
    }).format(date),
  );
}

export async function editSlip(slip: SlipDraft, request: EditRequest): Promise<SlipDraft> {
  const modification = request.intent.modification;
  if (!modification) throw new Error('No slip modification was provided.');
  let selections = [...slip.selections];
  if (modification.operation === 'remove') {
    const remove = new Set(modification.indices.map((index) => index - 1));
    if (modification.count) {
      for (const weak of [...selections].sort(weakestFirst).slice(0, modification.count)) {
        remove.add(selections.indexOf(weak));
      }
    }
    selections = selections.filter((selection, index) => {
      if (remove.has(index)) return false;
      if (
        modification.confidenceThreshold !== undefined &&
        selection.confidenceScore < modification.confidenceThreshold
      )
        return false;
      if (
        modification.startsAfterHour !== undefined &&
        lagosHour(selection.fixture.startsAt) >= modification.startsAfterHour
      )
        return false;
      return true;
    });
  } else if (modification.operation === 'keep' && modification.targetSport) {
    selections = selections.filter((selection) => selection.sport === modification.targetSport);
  } else if (modification.operation === 'replace' || modification.operation === 'convert') {
    selections = await replaceSelections(selections, request);
  } else if (modification.operation === 'optimize') {
    const mode: RiskMode = request.intent.riskPreference ?? slip.riskMode;
    if (request.intent.targetOdds || request.intent.riskPreference) {
      selections = await replaceSelections(selections, request);
    }
    const result = new SlipOptimizer().optimize({
      candidates: selections,
      gameCount: selections.length,
      ...(request.intent.targetOdds ? { targetOdds: request.intent.targetOdds } : {}),
      ...(request.intent.minimumConfidence !== undefined
        ? { minimumConfidence: request.intent.minimumConfidence }
        : {}),
      riskPreference: mode,
    });
    selections = result.selections;
  }
  if (selections.length === 0) throw new Error('That edit would leave the slip empty.');
  return {
    ...slip,
    id: crypto.randomUUID(),
    selections,
    ...(request.intent.targetOdds ? { targetOdds: request.intent.targetOdds } : {}),
    riskMode: request.intent.riskPreference ?? slip.riskMode,
  };
}

async function replaceSelections(
  selections: CandidateSelection[],
  request: EditRequest,
): Promise<CandidateSelection[]> {
  const indices = request.intent.modification?.indices ?? [];
  const replaceAll = indices.length === 0;
  return Promise.all(
    selections.map(async (selection, index) => {
      if (!replaceAll && !indices.includes(index + 1)) return selection;
      const markets = (await request.sportyBet.getMarkets(selection.eventId)).filter(
        (market) =>
          market.status === 'active' &&
          market.providerSelectionId !== selection.providerSelectionId,
      );
      if (/suspended/i.test(request.rawText)) {
        const current = (await request.sportyBet.getMarkets(selection.eventId)).find(
          (market) => market.providerSelectionId === selection.providerSelectionId,
        );
        if (current?.status === 'active') return selection;
      }
      if (
        /match winners?/i.test(request.rawText) &&
        !/result|winner|moneyline|1x2/i.test(`${selection.category} ${selection.marketName}`)
      ) {
        return selection;
      }
      const wantsGoals = request.intent.modification?.targetMarketCategory === 'goals';
      const candidates = wantsGoals
        ? markets.filter((market) =>
            /goal|total|over|under/i.test(`${market.category} ${market.marketName}`),
          )
        : markets;
      const alternative = candidates.sort((left, right) => {
        const desired = request.intent.targetOdds
          ? Math.pow(request.intent.targetOdds, 1 / selections.length)
          : request.intent.riskPreference === 'aggressive'
            ? 2.2
            : 1.35;
        return Math.abs(left.odds - desired) - Math.abs(right.odds - desired);
      })[0];
      if (!alternative) return selection;
      return {
        ...selection,
        ...alternative,
        modelProbability: Math.min(95, 100 / alternative.odds),
        confidenceScore: Math.min(95, 100 / alternative.odds),
        riskLevel:
          alternative.odds <= 1.4 ? 'lower' : alternative.odds <= 2.1 ? 'medium' : 'higher',
        reasoning: [
          'Replacement selected from currently active SportyBet markets; AI re-analysis required.',
        ],
      };
    }),
  );
}
