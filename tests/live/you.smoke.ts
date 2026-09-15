import assert from 'node:assert/strict';
import { YouClient } from '../../src/you/client.js';
import { normalizeSportsResearch } from '../../src/you/normalizer.js';

if (process.env.YOU_API_ENABLED !== 'true' || process.env.YOU_LIVE_SMOKE !== 'true' || !process.env.YDC_API_KEY) {
  throw new Error('Set YOU_API_ENABLED=true, YOU_LIVE_SMOKE=true, and YDC_API_KEY to run this opt-in smoke test.');
}

const client = new YouClient({
  apiKey: process.env.YDC_API_KEY,
  timeoutMs: Number(process.env.YOU_TIMEOUT_MS ?? 15_000),
  maxResults: Number(process.env.YOU_MAX_RESULTS ?? 3),
});
const query = 'latest official Arsenal football team injury news';
const response = await client.search(query);
const normalized = normalizeSportsResearch(
  'Live You.com sports search completed.',
  [...response.results.web, ...response.results.news],
  3,
);
assert(normalized.sources.length > 0, 'You.com returned no sources');
assert(normalized.sources.every((source) => new URL(source.url).protocol === 'https:'));
console.log(JSON.stringify({ status: 'passed', sources: normalized.sources.length, freshness: normalized.freshness }));
