import { GeminiSlipAnalyzer } from '../../src/ai/slip-analyzer.js';
import { SportyBetSlipBuilder } from '../../src/booking/workflow.js';
import { buildLiveSlipSnapshot } from '../../src/sportybet/discovery.js';
import { BrowserSportyBetProvider } from '../../src/sportybet/provider.js';

const apiKey = process.env.GEMINI_API_KEY ?? process.env.AI_API_KEY;
if (!apiKey) throw new Error('Gemini API key is unavailable to the production build.');
const provider = new BrowserSportyBetProvider({
  ...(process.env.SPORTYBET_API_BASE_URL ? { baseUrl: process.env.SPORTYBET_API_BASE_URL } : {}),
  ...(process.env.SPORTYBET_REGION ? { region: process.env.SPORTYBET_REGION } : {}),
  timeoutMs: 15_000,
  minIntervalMs: 100,
});
const analyzer = new GeminiSlipAnalyzer({
  apiKey,
  ...(process.env.AI_MODEL ? { model: process.env.AI_MODEL } : {}),
});
const builder = new SportyBetSlipBuilder(provider);
let result:
  | {
      aiModel: string;
      analyzedSelections: number;
      bookedSelections: number;
      resolvedSelections: number;
      bookingCodeCreated: boolean;
      wagerPlaced: boolean;
    }
  | undefined;
let lastError: unknown;
for (let attempt = 0; attempt < 5 && !result; attempt += 1) {
  try {
    const snapshot = await buildLiveSlipSnapshot(provider, 'basketball', 2, 3 + attempt * 0.1);
    const analysis = await analyzer.analyze(snapshot.slip.selections);
    if (analysis.selections.length !== snapshot.slip.selections.length) {
      throw new Error('AI did not analyze every selection.');
    }
    const allowed = snapshot.slip.selections.filter(
      (_, index) => analysis.selections[index]?.verdict !== 'reject',
    );
    if (!allowed.length) throw new Error('AI rejected every smoke-test selection.');
    const preparation = await builder.prepare(allowed, 1);
    if (preparation.status === 'unavailable') throw new Error(preparation.reason);
    const code = await provider.createBookingCode(preparation.selections);
    const resolved = await provider.resolveBookingCode(code);
    if (!resolved.length) throw new Error('Created SportyBet code could not be resolved.');
    result = {
      aiModel: analysis.model,
      analyzedSelections: analysis.selections.length,
      bookedSelections: allowed.length,
      resolvedSelections: resolved.length,
      bookingCodeCreated: true,
      wagerPlaced: false,
    };
  } catch (error) {
    lastError = error;
  }
}
if (!result) {
  throw lastError instanceof Error ? lastError : new Error('Analyzed booking smoke test failed.');
}
console.log(JSON.stringify(result));
