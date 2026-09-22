import { Redis } from 'ioredis';

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  health(): Promise<{ ok: boolean; detail: string }>;
  close(): Promise<void>;
}

export interface RedisConnection {
  status: string;
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  ping(): Promise<string>;
  disconnect(): void;
  on(event: 'error', listener: (error: unknown) => void): unknown;
}

export class RedisCache implements CacheService {
  private readonly client: RedisConnection;
  private connecting: Promise<void> | null = null;
  constructor(
    url: string,
    client?: RedisConnection,
    private readonly operationTimeoutMs = 1_750,
    private readonly connectionAttempts = 2,
  ) {
    this.client =
      client ??
      new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        retryStrategy: () => null,
      });
    this.client.on('error', () => undefined);
  }
  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Redis operation timed out')),
            this.operationTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async ensureReady(): Promise<void> {
    if (this.client.status === 'ready') return;
    if (!this.connecting) {
      this.connecting = (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < this.connectionAttempts; attempt += 1) {
          try {
            if (this.client.status !== 'connecting' && this.client.status !== 'connect') {
              await this.withTimeout(this.client.connect());
            } else {
              await this.withTimeout(this.client.ping());
            }
            if (this.client.status === 'ready') return;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError instanceof Error ? lastError : new Error('Redis connection unavailable');
      })().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }
  async get<T>(key: string): Promise<T | null> {
    await this.ensureReady();
    const raw = await this.withTimeout(this.client.get(key));
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.ensureReady();
    await this.withTimeout(this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds));
  }
  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.ensureReady();
      return { ok: (await this.withTimeout(this.client.ping())) === 'PONG', detail: 'Connected' };
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
