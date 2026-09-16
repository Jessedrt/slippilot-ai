import { describe, expect, it, vi } from 'vitest';
import { extractBookingCodes, extractXPostUrl, XPostReader } from '../src/social/x-post-reader.js';

describe('X post reader', () => {
  it('recognizes and canonicalizes public X and Twitter status links', () => {
    expect(extractXPostUrl('See https://twitter.com/tips/status/12345?s=20')).toBe(
      'https://x.com/tips/status/12345',
    );
    expect(extractXPostUrl('https://x.com/i/web/status/98765')).toBe(
      'https://x.com/i/web/status/98765',
    );
    expect(extractXPostUrl('https://evil.example/x.com/tips/status/12345')).toBeNull();
  });

  it('extracts contextual booking codes without treating ordinary words as codes', () => {
    expect(extractBookingCodes('SportyBet booking code: ab12CD. Good luck!')).toEqual(['AB12CD']);
  });

  it('reads public post text through the privacy-enhanced oEmbed endpoint', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          author_name: 'Slip Tips',
          html: "<blockquote><p>Today's pick<br>SportyBet booking code: AB12CD</p></blockquote>",
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await new XPostReader(request).read('https://x.com/tips/status/12345');

    expect(result.authorName).toBe('Slip Tips');
    expect(result.text).toContain("Today's pick\nSportyBet booking code: AB12CD");
    expect(result.bookingCodes).toEqual(['AB12CD']);
    expect(request).toHaveBeenCalledOnce();
    const requestedUrl = request.mock.calls[0]?.[0];
    expect(
      typeof requestedUrl === 'string'
        ? requestedUrl
        : requestedUrl instanceof Request
          ? requestedUrl.url
          : requestedUrl?.toString(),
    ).toContain('publish.twitter.com/oembed?');
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns no code when the code only exists in unseen media', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ html: '<blockquote><p>Code is in the image</p></blockquote>' }),
        {
          status: 200,
        },
      ),
    );
    const result = await new XPostReader(request).read('https://x.com/tips/status/12345');
    expect(result.bookingCodes).toEqual([]);
  });
});
