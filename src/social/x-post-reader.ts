const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

export interface XPostResult {
  url: string;
  authorName?: string;
  text: string;
  bookingCodes: string[];
}

interface OEmbedResponse {
  html?: string;
  author_name?: string;
}

export class XPostUnavailableError extends Error {}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] === '#') {
      const hexadecimal = key[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[key.toLowerCase()] ?? entity;
  });
}

function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function extractXPostUrl(input: string): string | null {
  const matches = input.match(/https?:\/\/[^\s<>]+/gi) ?? [];
  for (const match of matches) {
    try {
      const url = new URL(match.replace(/[),.!?]+$/, ''));
      if (!X_HOSTS.has(url.hostname.toLowerCase())) continue;
      if (!/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/\d+\/?$/.test(url.pathname)) continue;
      url.protocol = 'https:';
      url.hostname = 'x.com';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      // Ignore malformed links and continue looking for a valid post URL.
    }
  }
  return null;
}

export function extractBookingCodes(text: string): string[] {
  const codes = new Set<string>();
  const contextual =
    /(?:sportybet\s*)?(?:booking|bet)?\s*code\s*(?:is|:|-)?\s*#?([a-z0-9]{4,20})\b/gi;
  for (const match of text.matchAll(contextual)) codes.add(match[1]!.toUpperCase());

  if (/sportybet|booking\s*code|bet\s*code/i.test(text)) {
    for (const token of text.match(/\b[A-Za-z0-9]{4,12}\b/g) ?? []) {
      if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
      if (/^(?:https|twitter|sportybet)$/i.test(token)) continue;
      codes.add(token.toUpperCase());
    }
  }
  return [...codes].slice(0, 8);
}

export class XPostReader {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async read(rawUrl: string): Promise<XPostResult> {
    const url = extractXPostUrl(rawUrl);
    if (!url) throw new XPostUnavailableError('That is not a valid public X post link.');

    let response: Response;
    try {
      response = await this.request(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`,
        { signal: AbortSignal.timeout(this.timeoutMs) },
      );
    } catch {
      throw new XPostUnavailableError('X did not respond in time.');
    }
    if (!response.ok) {
      throw new XPostUnavailableError('The X post is unavailable, private, or deleted.');
    }

    const data = (await response.json()) as OEmbedResponse;
    const text = htmlToText(data.html ?? '');
    if (!text) throw new XPostUnavailableError('The X post contains no readable public text.');
    return {
      url,
      ...(data.author_name ? { authorName: data.author_name } : {}),
      text,
      bookingCodes: extractBookingCodes(text),
    };
  }
}
