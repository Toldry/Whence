import { describe, expect, it } from 'vitest';
import type { InboundResponse } from '../src/api/types';
import { computeRows, type ResultContext, type ResultFilters } from '../src/lib/results';
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
