import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReferenceData } from '../src/providers/reference-data.ts';
import { normalizeTimestamp, searchDateOf, TravelpayoutsProvider } from '../src/providers/travelpayouts.ts';
import type { InboundQuery } from '../src/types.ts';
import { UpstreamError } from '../src/types.ts';

const reference = ReferenceData.fromRecords({
  airports: [
    { code: 'LIS', name: 'Humberto Delgado', city_code: 'LIS', country_code: 'PT', coordinates: { lat: 38.77, lon: -9.13 }, flightable: true, iata_type: 'airport' },
    { code: 'ORY', name: 'Orly', city_code: 'PAR', country_code: 'FR', coordinates: { lat: 48.72, lon: 2.38 }, flightable: true, iata_type: 'airport' },
    { code: 'CDG', name: 'Charles de Gaulle', city_code: 'PAR', country_code: 'FR', coordinates: { lat: 49.01, lon: 2.55 }, flightable: true, iata_type: 'airport' },
  ],
  cities: [
    { code: 'LIS', name: 'Lisbon', country_code: 'PT', coordinates: { lat: 38.72, lon: -9.14 }, has_flightable_airport: true },
    { code: 'PAR', name: 'Paris', country_code: 'FR', coordinates: { lat: 48.86, lon: 2.35 }, has_flightable_airport: true },
    { code: 'LON', name: 'London', country_code: 'GB', coordinates: { lat: 51.51, lon: -0.13 }, has_flightable_airport: true },
  ],
  countries: [{ code: 'PT', name: 'Portugal' }, { code: 'FR', name: 'France' }, { code: 'GB', name: 'United Kingdom' }],
  airlines: [{ code: 'TO', name: 'Transavia France' }],
});

const query: InboundQuery = { destination: 'LIS', trip: 'round', dateMode: 'flex', month: '2027-03', flexKind: 'weekend' };

const pricesForDates = {
  success: true, currency: 'eur',
  data: [{
    origin: 'PAR', destination: 'LIS', origin_airport: 'ORY', destination_airport: 'LIS', price: 47,
    airline: 'TO', flight_number: '3400', departure_at: '2027-03-12T07:05:00+01:00',
    return_at: '2027-03-14T20:15:00+00:00', transfers: 0, return_transfers: 0,
    duration: 290, duration_to: 145, duration_back: 145,
    link: '/search/PAR1203LIS14031?t=TO17',
  }],
};
const latestPrices = {
  success: true, currency: 'eur',
  data: [
    // Live rows carry full timestamps, not the plain dates the docs show.
    { origin: 'PAR', destination: 'LIS', depart_date: '2027-03-12T07:05:00+01:00', return_date: '2027-03-14T20:15:00Z', number_of_changes: 0, value: 49, found_at: '2026-11-08T10:20:00' },
    { origin: 'LON', destination: 'LIS', depart_date: '2027-03-19T06:00:00Z', return_date: '2027-03-21T18:30:00Z', number_of_changes: 1, value: 61, found_at: '2026-11-07T09:00:00Z' },
  ],
};

function fakeFetch(handler: (url: URL) => { status: number; body: unknown }) {
  const calls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

test('merges both endpoints into contract fares with metadata', async () => {
  const { impl, calls } = fakeFetch((url) => ({
    status: 200, body: url.pathname.endsWith('prices_for_dates') ? pricesForDates : latestPrices,
  }));
  const provider = new TravelpayoutsProvider({ token: 't', marker: '12345', referenceData: reference, fetchImpl: impl });
  const result = await provider.searchInbound(query);

  // Each endpoint per day and per origin; prices_for_dates also nonstop-only.
  assert.equal(calls.length, 6);
  const datesCalls = calls.filter((c) => c.pathname.endsWith('prices_for_dates'));
  assert.deepEqual(
    datesCalls.map((c) => `${c.searchParams.get('unique')}/${c.searchParams.get('direct')}`).sort(),
    ['false/false', 'false/true', 'true/false', 'true/true']);
  const latestCalls = calls.filter((c) => c.pathname.endsWith('get_latest_prices'));
  assert.deepEqual(latestCalls.map((c) => c.searchParams.get('group_by')).sort(), ['dates', 'directions']);
  const datesCall = datesCalls[0]!;
  assert.equal(datesCall.searchParams.get('destination'), 'LIS');
  assert.equal(datesCall.searchParams.get('origin'), null);
  assert.equal(datesCall.searchParams.get('market'), 'pt'); // auto: destination country
  assert.equal(datesCall.searchParams.get('one_way'), 'false');
  // Flexible round trips leave the return month open (trips that cross into the next month).
  assert.equal(datesCall.searchParams.get('return_at'), null);
  // The per-day and per-origin calls return the same fare; it is kept once.
  assert.equal(result.fares.filter((f) => f.origin === 'ORY').length, 1);

  assert.deepEqual(result.fares[0], {
    origin: 'ORY', destination: 'LIS', price: 47, transfers: 0, airlines: ['Transavia France'],
    departure_at: '2027-03-12', return_at: '2027-03-14', duration_minutes: 145,
    found_at: '2026-11-08T10:20:00.000Z',
    link: 'https://www.aviasales.com/search/PAR1203LIS14031?t=TO17&marker=12345',
  });
  // London only appears in latest prices: city-level origin, no airline.
  const london = result.fares.find((f) => f.origin === 'LON')!;
  assert.deepEqual(london.airlines, []);
  assert.equal(london.transfers, 1);
  assert.equal(london.departure_at, '2027-03-19');
  assert.equal(london.return_at, '2027-03-21');
  assert.equal(london.link, 'https://www.aviasales.com/search/LON1903LIS21031?marker=12345');
  assert.equal(result.airports.LON?.name, 'London (all airports)');
  assert.equal(result.airports.ORY?.city, 'Paris');
  assert.equal(result.airports.LIS?.country, 'Portugal');
  // Paris already has a detailed fare, so its latest-prices row is not duplicated.
  assert.equal(result.fares.filter((f) => f.origin === 'PAR').length, 0);
});

test('one endpoint failing still returns the other', async () => {
  const { impl } = fakeFetch((url) => (url.pathname.endsWith('prices_for_dates')
    ? { status: 500, body: { success: false, error: 'boom' } } : { status: 200, body: latestPrices }));
  const provider = new TravelpayoutsProvider({ token: 't', referenceData: reference, fetchImpl: impl });
  const result = await provider.searchInbound(query);
  assert.deepEqual(result.fares.map((f) => f.origin).sort(), ['LON', 'PAR']);
});

test('both endpoints failing raises UpstreamError', async () => {
  const { impl } = fakeFetch(() => ({ status: 401, body: { success: false, error: 'Unauthorized' } }));
  const provider = new TravelpayoutsProvider({ token: 'bad', referenceData: reference, fetchImpl: impl });
  await assert.rejects(provider.searchInbound(query), UpstreamError);
});

test('reads further pages only while pages come back full', async () => {
  const { impl, calls } = fakeFetch((url) => {
    const page = Number(url.searchParams.get('page'));
    const rows = page === 1 ? [pricesForDates.data[0], pricesForDates.data[0]] : [pricesForDates.data[0]];
    return { status: 200, body: { success: true, data: url.pathname.endsWith('prices_for_dates') ? rows : [] } };
  });
  const provider = new TravelpayoutsProvider({ token: 't', referenceData: reference, fetchImpl: impl, pageSize: 2, maxPages: 5 });
  await provider.searchInbound(query);
  // Two pages for each of the four prices_for_dates calls.
  assert.equal(calls.filter((c) => c.pathname.endsWith('prices_for_dates')).length, 8);
});

test('exact round trips ask for the return date', async () => {
  const { impl, calls } = fakeFetch(() => ({ status: 200, body: { success: true, data: [] } }));
  const provider = new TravelpayoutsProvider({ token: 't', referenceData: reference, fetchImpl: impl });
  await provider.searchInbound({ destination: 'LIS', trip: 'round', dateMode: 'exact', depart: '2027-03-12', return: '2027-03-14' });
  const datesCall = calls.find((c) => c.pathname.endsWith('prices_for_dates'))!;
  assert.equal(datesCall.searchParams.get('departure_at'), '2027-03-12');
  assert.equal(datesCall.searchParams.get('return_at'), '2027-03-14');
});

test('fares without a latest-prices sighting take found_at from the link search_date', async () => {
  const unmatched = { ...pricesForDates, data: [{
    ...pricesForDates.data[0], departure_at: '2027-03-13T07:05:00+01:00', return_at: '2027-03-15T20:15:00Z',
    link: '/search/PAR1303LIS15031?t=TO17&search_date=09112026&expected_price=47',
  }] };
  const { impl } = fakeFetch((url) => ({
    status: 200, body: url.pathname.endsWith('prices_for_dates') ? unmatched : { success: true, data: [] },
  }));
  const provider = new TravelpayoutsProvider({ token: 't', referenceData: reference, fetchImpl: impl });
  const result = await provider.searchInbound(query);
  assert.equal(result.fares[0]?.found_at, '2026-11-09T00:00:00.000Z');
});

test('search_date parsing', () => {
  assert.equal(searchDateOf('/search/X?t=1&search_date=03112026&x=2'), '2026-11-03T00:00:00.000Z');
  assert.equal(searchDateOf('/search/X?t=1'), null);
  assert.equal(searchDateOf(undefined), null);
});

test('timestamps without a zone are read as UTC', () => {
  assert.equal(normalizeTimestamp('2026-11-08T10:20:00'), '2026-11-08T10:20:00.000Z');
  assert.equal(normalizeTimestamp('2026-11-08T12:20:00+02:00'), '2026-11-08T10:20:00.000Z');
  assert.equal(normalizeTimestamp(undefined), null);
  assert.equal(normalizeTimestamp('garbage'), null);
});

test('place search ranks code matches first and folds same-code city and airport', () => {
  const places = reference.searchPlaces('lis', 10);
  assert.equal(places[0]?.iata, 'LIS');
  assert.equal(places.filter((p) => p.iata === 'LIS').length, 1);
  assert.deepEqual(reference.searchPlaces('par', 10).map((p) => p.iata).sort(), ['CDG', 'ORY', 'PAR']);
});

test('self-transfer calls are cut off at the search budget instead of holding the search', async () => {
  const gateways = ReferenceData.fromRecords({
    airports: [
      { code: 'GUA', name: 'La Aurora', city_code: 'GUA', country_code: 'GT', coordinates: { lat: 14.58, lon: -90.53 }, flightable: true, iata_type: 'airport' },
      { code: 'MAD', name: 'Barajas', city_code: 'MAD', country_code: 'ES', coordinates: { lat: 40.47, lon: -3.56 }, flightable: true, iata_type: 'airport' },
    ],
    cities: [
      { code: 'GUA', name: 'Guatemala City', country_code: 'GT', coordinates: { lat: 14.62, lon: -90.51 }, has_flightable_airport: true },
      { code: 'MAD', name: 'Madrid', country_code: 'ES', coordinates: { lat: 40.42, lon: -3.7 }, has_flightable_airport: true },
    ],
    countries: [{ code: 'GT', name: 'Guatemala' }, { code: 'ES', name: 'Spain' }],
    airlines: [],
  });
  const nonstop = {
    success: true,
    data: [{ origin: 'MAD', destination: 'GUA', origin_airport: 'MAD', price: 900, departure_at: '2026-12-03T12:00:00+01:00', transfers: 0 }],
  };
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    // The hub lookups (into MAD, or out of MAD) never answer until aborted.
    if (url.searchParams.get('destination') === 'MAD' || url.searchParams.get('origin') === 'MAD') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
    const body = url.pathname.endsWith('prices_for_dates') ? nonstop : { success: true, data: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const provider = new TravelpayoutsProvider({
    token: 't', referenceData: gateways, fetchImpl: impl, searchBudgetMs: 2_300,
  });
  // AbortSignal.timeout timers do not keep Node's event loop alive on their own.
  const keepAlive = setInterval(() => {}, 1_000);
  const started = Date.now();
  const result = await provider.searchInbound(
    { destination: 'GUA', trip: 'oneway', dateMode: 'flex', month: '2026-12', flexKind: 'week' })
    .finally(() => clearInterval(keepAlive));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3_500, `took ${elapsed} ms`);
  assert.deepEqual(result.fares.map((fare) => fare.origin), ['MAD']);
});

test('a later page that fails keeps the rows from earlier pages', async () => {
  const full = { success: true, data: Array.from({ length: 2 }, () => pricesForDates.data[0]) };
  const { impl } = fakeFetch((url) => (url.searchParams.get('page') === '1'
    ? { status: 200, body: url.pathname.endsWith('prices_for_dates') ? full : { success: true, data: [] } }
    : { status: 500, body: { success: false, error: 'boom' } }));
  const provider = new TravelpayoutsProvider({ token: 't', referenceData: reference, fetchImpl: impl, pageSize: 2 });
  const result = await provider.searchInbound(query);
  assert.ok(result.fares.length > 0);
});
