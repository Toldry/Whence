import type { CacheHit, FareCache } from './cache.ts';

/** The slice of the Workers KV binding this cache uses. */
export interface KvNamespaceLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface KvCacheOptions {
  kv: KvNamespaceLike;
  ttlMs: number;
  /** Extra time past the TTL during which a value may be served if loading fails. */
  staleMs: number;
  /** Prefix for keys, so several caches can share one namespace. */
  prefix?: string;
  now?: () => number;
}

interface Stored<V> { value: V; storedAt: number }

/**
 * TTL cache with serve-stale-on-error on Workers KV, shared by every isolate.
 * KV is eventually consistent (about 60 s across locations), which is fine for
 * prices that are already days old. Concurrent misses in one isolate share a load.
 */
export class KvCache<V> implements FareCache<V> {
  private readonly inFlight = new Map<string, Promise<V>>();
  private readonly options: KvCacheOptions & { prefix: string; now: () => number };

  constructor(options: KvCacheOptions) {
    this.options = { prefix: '', now: Date.now, ...options };
  }

  async getOrLoad(key: string, load: () => Promise<V>): Promise<CacheHit<V>> {
    const storageKey = this.options.prefix + key;
    const entry = (await this.options.kv.get(storageKey, 'json').catch(() => null)) as Stored<V> | null;
    const age = entry ? this.options.now() - entry.storedAt : Infinity;
    if (entry && age <= this.options.ttlMs) return { value: entry.value, cached: true, stale: false };
    try {
      return { value: await this.loadShared(storageKey, load), cached: false, stale: false };
    } catch (error) {
      if (entry && age <= this.options.ttlMs + this.options.staleMs) {
        return { value: entry.value, cached: true, stale: true };
      }
      throw error;
    }
  }

  private loadShared(storageKey: string, load: () => Promise<V>): Promise<V> {
    const pending = this.inFlight.get(storageKey);
    if (pending) return pending;
    const promise = load()
      // The write is awaited: a Worker may drop work still pending after it responds.
      .then(async (value) => { await this.store(storageKey, value); return value; })
      .finally(() => this.inFlight.delete(storageKey));
    this.inFlight.set(storageKey, promise);
    return promise;
  }

  private async store(storageKey: string, value: V): Promise<void> {
    const stored: Stored<V> = { value, storedAt: this.options.now() };
    // KV's minimum expiration is 60 s.
    const expirationTtl = Math.max(60, Math.ceil((this.options.ttlMs + this.options.staleMs) / 1000));
    await this.options.kv.put(storageKey, JSON.stringify(stored), { expirationTtl })
      .catch((error: unknown) => console.warn('[kv-cache] write failed:', String(error)));
  }
}
