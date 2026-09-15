import { Redis } from 'ioredis';

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  health(): Promise<{ ok: boolean; detail: string }>;
  close(): Promise<void>;
}

export class RedisCache implements CacheService {
  private readonly client: Redis;
  constructor(url: string) {
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      retryStrategy: () => null,
    });
    this.client.on('error', () => undefined);
  }
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return { ok: (await this.client.ping()) === 'PONG', detail: 'Connected' };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? 'Connection unavailable' : 'Unavailable',
      };
    }
  }
  close(): Promise<void> {
    if (this.client.status !== 'end') this.client.disconnect();
    return Promise.resolve();
  }
}
