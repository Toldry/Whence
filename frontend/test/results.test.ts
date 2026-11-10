import { describe, expect, it } from 'vitest';
import type { InboundResponse } from '../src/api/types';
import {
  assignTiers, computeRows, SORTERS, tierForBin,
  type OriginRow, type ResultContext, type ResultFilters,
} from '../src/lib/results';
import { HOME_BY_NAME, MOCK_AIRPORTS } from '../src/data/places';

const airport = (iata: string) => MOCK_AIRPORTS.find(a => a.iata === iata)!;
const now = Date.parse('2026-11-10T00:00:00Z');
const fare = (origin: string, price: number, transfers = 0, foundAt: string | null = '2026-11-07T00:00:00Z') => ({
  origin, destination: 'LIS', price, transfers, airlines: ['Test Air'],
  departure_at: '2027-03-12', return_at: '2027-03-14', found_at: foundAt, link: 'https://example.test',
});
const response: InboundResponse = {
  destination: 'LIS', currency: 'EUR',
  fares: [fare('LYS', 126), fare('LYS', 98, 1), fare('GVA', 64), fare('JFK', 412, 0, null)],
  airports: { LYS: airport('LYS'), GVA: airport('GVA'), JFK: airport('JFK') },
};
const ctx = (over: Partial<ResultContext> = {}): ResultContext => ({
  response, destination: { lat: 38.774, lon: -9.134 }, trip: 'round', cabin: 'Economy',
  travellers: { adults: 1, children: 0, infants: 0 }, home: null, now, ...over,
});
const noFilters: ResultFilters = { scope: { type: 'anywhere' }, stops: 'any', maxPrice: null, airlines: [], maxDurationHours: null };

describe('computeRows', () => {
  it('keeps the cheapest fare per origin and remembers a nonstop alternative', () => {
    const lyon = computeRows(ctx(), noFilters).find(r => r.airport.iata === 'LYS')!;
    expect(lyon.flight).toBe(98);
    expect(lyon.nonstopAlternative?.flight).toBe(126);
  });

  it('applies the nonstop filter before picking the cheapest', () => {
    const lyon = computeRows(ctx(), { ...noFilters, stops: '0' }).find(r => r.airport.iata === 'LYS')!;
    expect(lyon.flight).toBe(126);
  });

  it('adds a round-trip ground estimate when a home city is set', () => {
    const lyon = computeRows(ctx({ home: HOME_BY_NAME.Lyon }), noFilters).find(r => r.airport.iata === 'LYS')!;
    expect(lyon.ground?.mode).toBe('transfer');
    expect(lyon.groundCost).toBe(18);
    expect(lyon.total).toBe(116);
  });

  it('caps the total trip cost, not just the flight, when a home city is set', () => {
    const rows = computeRows(ctx({ home: HOME_BY_NAME.Lyon }), noFilters);
    const lyon = rows.find(r => r.airport.iata === 'LYS')!;
    const capped = computeRows(ctx({ home: HOME_BY_NAME.Lyon }), { ...noFilters, maxPrice: lyon.total - 1 });
    expect(capped.find(r => r.airport.iata === 'LYS')).toBeUndefined();
    expect(capped.every(r => r.total <= lyon.total - 1)).toBe(true);
    // Without a home city the same cap only looks at the flight, so Lyon stays.
    const flightOnly = computeRows(ctx(), { ...noFilters, maxPrice: lyon.total - 1 });
    expect(flightOnly.find(r => r.airport.iata === 'LYS')).toBeDefined();
  });

  it('filters by region and tolerates an unknown price age', () => {
    const rows = computeRows(ctx(), { ...noFilters, scope: { type: 'region', region: 'na' } });
    expect(rows.map(r => r.airport.iata)).toEqual(['JFK']);
    expect(rows[0].ageHours).toBeNull();
  });

  it('scales price for cabin and travellers', () => {
    const geneva = computeRows(ctx({ cabin: 'Business', travellers: { adults: 2, children: 0, infants: 0 } }), noFilters)
      .find(r => r.airport.iata === 'GVA')!;
    expect(geneva.flight).toBeCloseTo(64 * 3.1 * 2);
  });
});

describe('assignTiers', () => {
  const rowsWith = (values: number[]) =>
    values.map(value => ({ value, tier: -1 })) as unknown as OriginRow[];

  it('merges repeated thresholds so bins rise strictly', () => {
    const rows = rowsWith([25, 25, 25, 25, 28, 28, 28, 45, 66, 95]);
    const starts = assignTiers(rows);
    expect(starts).toEqual([...new Set(starts)]);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts[0]).toBe(25);
  });

  it('keeps tiers monotonic in price, from green to red', () => {
    const rows = rowsWith([25, 25, 25, 25, 28, 28, 28, 45, 66, 95]);
    assignTiers(rows);
    const sorted = [...rows].sort((a, b) => a.value - b.value);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].tier).toBeGreaterThanOrEqual(sorted[i - 1].tier);
    expect(sorted[0].tier).toBe(0);
    expect(sorted.at(-1)!.tier).toBe(4);
  });

  it('maps bins onto the palette ends', () => {
    expect(tierForBin(0, 3)).toBe(0);
    expect(tierForBin(2, 3)).toBe(4);
    expect(tierForBin(0, 1)).toBe(0);
  });
});

describe('date sort', () => {
  it('puts the earliest departure first', () => {
    const row = (departure_at: string, flight: number) => ({ fare: { departure_at }, flight }) as unknown as OriginRow;
    const rows = [row('2026-11-20T08:00:00Z', 10), row('2026-11-14T08:00:00Z', 90), row('2026-11-14T08:00:00Z', 50)];
    expect(rows.sort(SORTERS.date).map(r => r.flight)).toEqual([50, 90, 10]);
  });
});
