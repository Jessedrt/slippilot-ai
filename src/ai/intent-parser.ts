import { intentSchema, type ParsedIntent, type StructuredIntentProvider } from './intent-schema.js';

const words: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
};

function numberValue(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : words[value.toLowerCase()];
}

function matchNumber(text: string, expression: RegExp): number | undefined {
  const match = expression.exec(text);
  return match?.[1] ? numberValue(match[1]) : undefined;
}

export function deterministicParse(input: string): ParsedIntent {
  const text = input.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const sport = /basketball|nba|wnba|euroleague/.test(lower)
    ? 'basketball'
    : /football|soccer|match|goal/.test(lower)
      ? 'football'
      : undefined;
  const range =
    /between\s+(\w+(?:\.\d+)?)\s+and\s+(\w+(?:\.\d+)?)(?:\s+(?:games?|matches?))?/i.exec(text);
  const minimumGameCount = range?.[1] ? numberValue(range[1]) : undefined;
  const maximumGameCount = range?.[2] ? numberValue(range[2]) : undefined;
  const gameCount = range
    ? undefined
    : matchNumber(
        text,
        /(?:give me|find|want|build|with)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen)\s+(?:football\s+|basketball\s+)?(?:games?|matches?|selections?|picks?)/i,
      );

  const oddsRange = /between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s+odds/i.exec(text);
  const explicitTarget = matchNumber(
    text,
    /(?:around|about|near|close to|target|to)\s+(\d+(?:\.\d+)?)\s*(?:total\s+)?odds/i,
  );
  const simpleOdds = matchNumber(text, /(?:give me|want)\s+(\d+(?:\.\d+)?)\s+odds/i);
  const minimumConfidence = matchNumber(
    text,
    /(?:at least|above|minimum|min|below)\s+(\d+(?:\.\d+)?)\s*%?(?:\s+confidence)?/i,
  );
  const indices = Array.from(lower.matchAll(/(?:game|selection|number|pick)\s*(\d+)/g)).map((m) =>
    Number(m[1]),
  );
  const weakestMatch =
    /weakest\s+(\d+|one|two|three|four|five)|(?:remove|replace)\s+(?:the\s+)?(\d+|one|two|three|four|five)\s+weakest/i.exec(
      text,
    );
  const weakestCount = weakestMatch
    ? numberValue(weakestMatch[1] ?? weakestMatch[2] ?? '')
    : undefined;
  const splitCount = matchNumber(
    text,
    /split(?:\s+(?:this\s+)?ticket)?\s+(?:into|in\s+to|to)\s*(\d+)/i,
  );

  let action: ParsedIntent['action'] = 'unknown';
  if (/screenshot|photo|image/.test(lower)) action = 'read_screenshot';
  else if (/generate|book these|booking code|prepare.*code/.test(lower)) action = 'generate_code';
  else if (/readcode|analy[sz]e.*code|^[a-z0-9]{4,12}$/i.test(text)) action = 'read_code';
  else if (/split/.test(lower)) action = 'split_slip';
  else if (/remove|replace|change|keep only|reduce|increase|make.*safer|get.*close/.test(lower))
    action = 'modify_slip';
  else if (/market|explore/.test(lower)) action = 'explore_markets';
  else if (/analy[sz]e/.test(lower)) action = 'analyze';
  else if (/give me|find|build|games|matches|picks|selections/.test(lower)) action = 'discover';

  const operation = /replace/.test(lower)
    ? 'replace'
    : /remove/.test(lower)
      ? 'remove'
      : /keep only/.test(lower)
        ? 'keep'
        : /change.*(?:goal|market)/.test(lower)
          ? 'convert'
          : /reduce|increase|safer|close/.test(lower)
            ? 'optimize'
            : undefined;

  const possibleCode = /\b([A-Z0-9]{4,12})\b/.exec(text)?.[1];
  return intentSchema.parse({
    action,
    ...(sport ? { sport } : {}),
    ...(gameCount ? { gameCount } : {}),
    ...(minimumGameCount ? { minimumGameCount } : {}),
    ...(maximumGameCount ? { maximumGameCount } : {}),
    ...((explicitTarget ?? simpleOdds) ? { targetOdds: explicitTarget ?? simpleOdds } : {}),
    ...(oddsRange?.[1] ? { minimumOdds: Number(oddsRange[1]) } : {}),
    ...(oddsRange?.[2] ? { maximumOdds: Number(oddsRange[2]) } : {}),
    ...(minimumConfidence ? { minimumConfidence } : {}),
    ...(lower.includes('conservative') || lower.includes('safer') || lower.includes('safe')
      ? { riskPreference: 'conservative' }
      : lower.includes('aggressive')
        ? { riskPreference: 'aggressive' }
        : {}),
    marketPreferences: /goal/.test(lower) ? ['goals'] : [],
    screenshotIntent: action === 'read_screenshot',
    ...(action === 'read_code' && possibleCode ? { bookingCode: possibleCode } : {}),
    ...(operation
      ? {
          modification: {
            operation,
            indices,
            ...(weakestCount ? { count: weakestCount } : {}),
            ...(minimumConfidence ? { confidenceThreshold: minimumConfidence } : {}),
            ...(/goal/.test(lower) ? { targetMarketCategory: 'goals' } : {}),
            ...(/keep only basketball/.test(lower)
              ? { targetSport: 'basketball' }
              : /keep only football/.test(lower)
                ? { targetSport: 'football' }
                : {}),
          },
        }
      : {}),
    ...(splitCount ? { splitCount } : {}),
  });
}

export class IntentParser {
  constructor(private readonly structuredProvider?: StructuredIntentProvider) {}

  async parse(text: string): Promise<ParsedIntent> {
    if (this.structuredProvider) {
      try {
        const result = intentSchema.safeParse(await this.structuredProvider.parse(text));
        if (result.success) return result.data;
      } catch {
        // Deterministic parsing keeps core Telegram flows available during AI outages.
      }
    }
    return deterministicParse(text);
  }
}
