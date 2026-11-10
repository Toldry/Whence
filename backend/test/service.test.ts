import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalizeResult } from '../src/service.ts';
import type { AirportInfo, Fare, InboundQuery, InboundResult } from '../src/types.ts';

const query: InboundQuery = { destination: 'LIS', trip: 'round', dateMode: 'flex', month: '2027-03', flexKind: 'weekend' };
const airport = (iata: string): AirportInfo =>
  ({ iata, name: iata, city: iata, country: 'X', country_code: 'XX', lat: 1, lon: 2 });
const fare = (origin: string, price: number, transfers: number, departure_at = '2027-03-12', return_at = '2027-03-14'): Fare => ({
  origin, destination: 'LIS', price, transfers, airlines: [], departure_at, return_at,
  duration_minutes: null, found_at: null, link: 'https://example.test',
});

test('keeps the cheapest fare and the cheapest nonstop per origin', () => {
  const raw: InboundResult = {
    destination: 'LIS', currency: 'EUR',
    fares: [fare('LYS', 126, 0), fare('LYS', 98, 1), fare('LYS', 140, 0), fare('LYS', 110, 1), fare('MAD', 58, 0)],
    airports: { LIS: airport('LIS'), LYS: airport('LYS'), MAD: airport('MAD') },
  };
  const result = finalizeResult(raw, query, '2026-11-10');
  assert.deepEqual(result.fares.map((f) => `${f.origin}:${f.price}`), ['MAD:58', 'LYS:98', 'LYS:126']);
});

test('drops fares that do not fit, cannot be plotted, or come from the destination', () => {
  const raw: InboundResult = {
    destination: 'LIS', currency: 'EUR',
    fares: [
      fare('MAD', 58, 0, '2027-03-09', '2027-03-11'), // midweek
      fare('ZZZ', 40, 0), // no airport metadata
      fare('LIS', 10, 0), // origin is the destination
      fare('BCN', 49, 0),
    ],
    airports: { LIS: airport('LIS'), MAD: airport('MAD'), BCN: airport('BCN'), UNUSED: airport('UNUSED') },
  };
  const result = finalizeResult(raw, query, '2026-11-10');
  assert.deepEqual(result.fares.map((f) => f.origin), ['BCN']);
  assert.deepEqual(Object.keys(result.airports).sort(), ['BCN', 'LIS']);
});
