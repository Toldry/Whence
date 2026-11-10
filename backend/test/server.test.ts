import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createService, loadConfig } from '../src/config.ts';
import { createApp } from '../src/server.ts';
import type { FareProvider } from '../src/types.ts';
import { UpstreamError } from '../src/types.ts';

let baseUrl = '';
const server = createApp(createService(loadConfig({})), { corsOrigins: ['*'] });
const failingProvider: FareProvider = {
  name: 'failing',
  searchInbound: async () => { throw new UpstreamError('down'); },
  searchPlaces: async () => [],
};
const failingServer = createApp(createService(loadConfig({}), failingProvider), { corsOrigins: ['*'] });
let failingUrl = '';

before(async () => {
  console.log = () => {};
  console.error = () => {};
  for (const [s, set] of [[server, (u: string) => { baseUrl = u; }], [failingServer, (u: string) => { failingUrl = u; }]] as const) {
    await new Promise<void>((resolve) => s.listen(0, resolve));
    set(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  }
});
after(() => { server.close(); failingServer.close(); });

test('GET /api/inbound returns the contract shape from the mock provider', async () => {
  const response = await fetch(`${baseUrl}/api/inbound?destination=LIS&trip=round&date_mode=flex&month=2027-03&flex_kind=weekend`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  const body = await response.json();
  assert.equal(body.destination, 'LIS');
  assert.equal(body.currency, 'EUR');
  assert.ok(body.fares.length > 30);
  for (const fare of body.fares) {
    assert.ok(body.airports[fare.origin], `airport metadata for ${fare.origin}`);
    assert.equal(typeof fare.price, 'number');
    assert.match(fare.departure_at, /^2027-03-\d{2}$/);
  }
  assert.ok(body.airports.LIS);
  assert.equal(body.meta.provider, 'mock');
});

test('a repeated search is served from the cache', async () => {
  const url = `${baseUrl}/api/inbound?destination=LIS&month=2027-04&flex_kind=week`;
  await fetch(url);
  const body = await (await fetch(url)).json();
  assert.equal(body.meta.cached, true);
});

test('bad parameters give 400 invalid_params', async () => {
  const response = await fetch(`${baseUrl}/api/inbound?destination=LIS&month=March`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'invalid_params');
});

test('an upstream failure gives 502 upstream_unavailable', async () => {
  const response = await fetch(`${failingUrl}/api/inbound?destination=LIS&month=2027-03`);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'upstream_unavailable');
});

test('GET /api/places finds destinations', async () => {
  const places = await (await fetch(`${baseUrl}/api/places?q=reyk`)).json();
  assert.equal(places[0].iata, 'KEF');
});

test('unknown routes give 404', async () => {
  assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
});
