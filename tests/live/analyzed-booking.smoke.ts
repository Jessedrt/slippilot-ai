import { GeminiSlipAnalyzer } from '../../src/ai/slip-analyzer.js';
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
const snapshot = await buildLiveSlipSnapshot(provider, 'basketball', 2, 3);
const analysis = await new GeminiSlipAnalyzer({
  apiKey,
  ...(process.env.AI_MODEL ? { model: process.env.AI_MODEL } : {}),
}).analyze(snapshot.slip.selections);
if (analysis.selections.length !== snapshot.slip.selections.length) {
  throw new Error('AI did not analyze every selection.');
}
const allowed = snapshot.slip.selections.filter(
  (_, index) => analysis.selections[index]?.verdict !== 'reject',
);
if (!allowed.length) throw new Error('AI rejected every smoke-test selection.');
const code = await provider.createBookingCode(allowed);
const resolved = await provider.resolveBookingCode(code);
if (!resolved.length) throw new Error('Created SportyBet code could not be resolved.');
console.log(
  JSON.stringify({
    aiModel: analysis.model,
    analyzedSelections: analysis.selections.length,
    bookedSelections: allowed.length,
    resolvedSelections: resolved.length,
    bookingCodeCreated: true,
    wagerPlaced: false,
  }),
);
