/**
 * In-memory TTL cache with LRU eviction, in-flight request sharing, and
 * serve-stale-on-error. Upstream prices are already days old, so a stale
 * answer beats an error page.
 */
export interface CacheHit<V> {
  value: V;
  /** True when the value came from the cache rather than a fresh load. */
  cached: boolean;
  /** True when the value is past its TTL and was served because loading failed. */
  stale: boolean;
}

/** What the service needs from a cache: in memory (TtlCache) or Workers KV (KvCache). */
export interface FareCache<V> {
  getOrLoad(key: string, load: () => Promise<V>): Promise<CacheHit<V>>;
}

interface Entry<V> { value: V; storedAt: number }

export interface TtlCacheOptions {
  maxEntries: number;
  ttlMs: number;
  /** Extra time past the TTL during which a value may be served if loading fails. */
  staleMs: number;
  now?: () => number;
}

export class TtlCache<V> implements FareCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inFlight = new Map<string, Promise<V>>();
  private readonly options: Required<TtlCacheOptions>;

  constructor(options: TtlCacheOptions) {
    this.options = { now: Date.now, ...options };
  }

  get size(): number { return this.entries.size; }

  async getOrLoad(key: string, load: () => Promise<V>): Promise<CacheHit<V>> {
    const entry = this.entries.get(key);
    const age = entry ? this.options.now() - entry.storedAt : Infinity;
    if (entry && age <= this.options.ttlMs) {
      this.touch(key, entry);
      return { value: entry.value, cached: true, stale: false };
    }
    try {
      const value = await this.loadShared(key, load);
      return { value, cached: false, stale: false };
    } catch (error) {
      if (entry && age <= this.options.ttlMs + this.options.staleMs) {
        return { value: entry.value, cached: true, stale: true };
      }
      throw error;
    }
  }

  private loadShared(key: string, load: () => Promise<V>): Promise<V> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = load()
      .then((value) => { this.store(key, value); return value; })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private store(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.options.now() });
    while (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string;
      this.entries.delete(oldestKey);
    }
  }

  private touch(key: string, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
