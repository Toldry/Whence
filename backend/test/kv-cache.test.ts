import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KvCache } from '../src/kv-cache.ts';
import type { KvNamespaceLike } from '../src/kv-cache.ts';

function fakeKv() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const kv: KvNamespaceLike = {
    get: async (key) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
    put: async (key, value, options) => { store.set(key, value); ttls.set(key, options?.expirationTtl); },
  };
  return { kv, store, ttls };
}

test('a fresh value is served from KV without loading', async () => {
  let now = 0;
  const { kv, ttls } = fakeKv();
  const cache = new KvCache<number>({ kv, ttlMs: 1000, staleMs: 5000, prefix: 'p:', now: () => now });
  assert.deepEqual(await cache.getOrLoad('a', async () => 1), { value: 1, cached: false, stale: false });
  assert.equal(ttls.get('p:a'), 60, 'expiration is at least KV\'s 60 s minimum');
  now = 500;
  assert.deepEqual(await cache.getOrLoad('a', async () => 2), { value: 1, cached: true, stale: false });
});

test('an expired value is reloaded, and served stale when loading fails', async () => {
  let now = 0;
  const { kv } = fakeKv();
  const cache = new KvCache<number>({ kv, ttlMs: 1000, staleMs: 5000, now: () => now });
  await cache.getOrLoad('a', async () => 1);
  now = 2000;
  assert.deepEqual(await cache.getOrLoad('a', async () => { throw new Error('down'); }),
    { value: 1, cached: true, stale: true });
  assert.deepEqual(await cache.getOrLoad('a', async () => 3), { value: 3, cached: false, stale: false });
  now = 99_000;
  await assert.rejects(cache.getOrLoad('a', async () => { throw new Error('down'); }));
});

test('concurrent misses share one load', async () => {
  const { kv } = fakeKv();
  const cache = new KvCache<number>({ kv, ttlMs: 1000, staleMs: 0 });
  let loads = 0;
  const load = async () => { loads++; await new Promise((r) => setTimeout(r, 10)); return 7; };
  await Promise.all([cache.getOrLoad('a', load), cache.getOrLoad('a', load)]);
  assert.equal(loads, 1);
});
