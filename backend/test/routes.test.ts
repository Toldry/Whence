import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createService, loadConfig } from '../src/config.ts';
import { handleRequest } from '../src/routes.ts';

const service = createService(loadConfig({}));
const options = { corsOrigins: ['https://toldry.github.io', 'http://localhost:5173'] };
const get = (path: string, origin?: string) =>
  handleRequest(new Request(`https://api.example${path}`, { headers: origin ? { Origin: origin } : {} }), service, options);

test('an allowed origin is echoed back', async () => {
  const response = await get('/api/health', 'https://toldry.github.io');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://toldry.github.io');
  assert.equal(response.headers.get('vary'), 'Origin');
});

test('another origin gets no CORS header', async () => {
  const response = await get('/api/health', 'https://evil.example');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('a preflight answers 204 with the allowed methods', async () => {
  const response = await handleRequest(new Request('https://api.example/api/inbound', {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' },
  }), service, options);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /GET/);
});

test('CORS_ORIGINS is a comma-separated list', () => {
  assert.deepEqual(loadConfig({ CORS_ORIGINS: 'https://a.example, https://b.example' }).corsOrigins,
    ['https://a.example', 'https://b.example']);
  assert.deepEqual(loadConfig({}).corsOrigins, ['*']);
});

test('bundled reference data describes airports and finds places', async () => {
  const places = await service.searchPlaces('lisb', 5);
  assert.ok(places.some((place) => place.iata === 'LIS'));
});
