import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/cache.ts';

function makeCache(maxEntries = 10) {
  const clock = { now: 0 };
  const cache = new TtlCache<string>({ maxEntries, ttlMs: 1000, staleMs: 5000, now: () => clock.now });
  return { cache, clock };
}

test('serves fresh hits from the cache', async () => {
  const { cache } = makeCache();
  let loads = 0;
  const load = async () => `value ${++loads}`;
  assert.deepEqual(await cache.getOrLoad('k', load), { value: 'value 1', cached: false, stale: false });
  assert.deepEqual(await cache.getOrLoad('k', load), { value: 'value 1', cached: true, stale: false });
  assert.equal(loads, 1);
});

test('reloads after the TTL', async () => {
  const { cache, clock } = makeCache();
  let loads = 0;
  await cache.getOrLoad('k', async () => `v${++loads}`);
  clock.now = 1500;
  assert.equal((await cache.getOrLoad('k', async () => `v${++loads}`)).value, 'v2');
});

test('shares one in-flight load between concurrent callers', async () => {
  const { cache } = makeCache();
  let loads = 0;
  const load = () => new Promise<string>((resolve) => setTimeout(() => resolve(`v${++loads}`), 10));
  const [a, b] = await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
  assert.equal(a.value, 'v1');
  assert.equal(b.value, 'v1');
  assert.equal(loads, 1);
});

test('serves a stale value when the reload fails, then gives up', async () => {
  const { cache, clock } = makeCache();
  await cache.getOrLoad('k', async () => 'old');
  const failing = async (): Promise<string> => { throw new Error('upstream down'); };
  clock.now = 3000;
  assert.deepEqual(await cache.getOrLoad('k', failing), { value: 'old', cached: true, stale: true });
  clock.now = 7000;
  await assert.rejects(cache.getOrLoad('k', failing), /upstream down/);
});

test('evicts the least recently used entry', async () => {
  const { cache } = makeCache(2);
  await cache.getOrLoad('a', async () => 'a');
  await cache.getOrLoad('b', async () => 'b');
  await cache.getOrLoad('a', async () => 'a2'); // touch a
  await cache.getOrLoad('c', async () => 'c'); // evicts b
  assert.equal((await cache.getOrLoad('a', async () => 'reloaded')).value, 'a');
  assert.equal((await cache.getOrLoad('b', async () => 'reloaded')).value, 'reloaded');
});
