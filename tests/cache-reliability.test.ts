import { describe, expect, it, vi } from 'vitest';
import { RedisCache, type RedisConnection } from '../src/services/cache.js';
import { YouClient } from '../src/you/client.js';

class FakeRedis implements RedisConnection {
  status = 'wait';
  connectCalls = 0;
  failConnect = false;
  failNextGet = false;
  private readonly values = new Map<string, string>();
  on(): this {
    return this;
  }
  connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.failConnect) return Promise.reject(new Error('connection refused'));
    this.status = 'ready';
    return Promise.resolve();
  }
  get(key: string): Promise<string | null> {
    if (this.failNextGet) {
      this.failNextGet = false;
      this.status = 'wait';
      return Promise.reject(new Error("Stream isn't writeable"));
    }
    return Promise.resolve(this.values.get(key) ?? null);
  }
  set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }
  ping(): Promise<string> {
    return Promise.resolve(this.status === 'ready' ? 'PONG' : 'NO');
  }
  disconnect(): void {
    this.status = 'end';
  }
}

const searchPayload = { results: { web: [], news: [] }, metadata: { query: 'test' } };

describe('Redis optional-cache reliability', () => {
  it('fails quickly and predictably when Redis is unavailable at startup', async () => {
    const redis = new FakeRedis();
    redis.failConnect = true;
    const cache = new RedisCache('redis://unused', redis, 50, 2);
    await expect(cache.get('key')).rejects.toThrow('connection refused');
    expect(redis.connectCalls).toBe(2);
    await expect(cache.health()).resolves.toMatchObject({ ok: false });
  });

  it('falls back to mandatory live research after a cache disconnect', async () => {
    const redis = new FakeRedis();
    await redis.connect();
    redis.failNextGet = true;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(searchPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new YouClient({
      apiKey: 'test-key',
      cache: new RedisCache('redis://unused', redis),
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
    });
    await expect(client.search('test')).resolves.toMatchObject(searchPayload);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reconnects and resumes cache operations after a request-time disconnect', async () => {
    const redis = new FakeRedis();
    const cache = new RedisCache('redis://unused', redis);
    await cache.set('key', { version: 1 }, 60);
    redis.failNextGet = true;
    await expect(cache.get('key')).rejects.toThrow("Stream isn't writeable");
    await expect(cache.get<{ version: number }>('key')).resolves.toEqual({ version: 1 });
    expect(redis.connectCalls).toBe(2);
  });
});
