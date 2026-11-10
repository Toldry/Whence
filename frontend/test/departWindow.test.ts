import { describe, expect, it } from 'vitest';
import { daysInMonth, departWindow, END_OF_SPAN, initialState, searchMonths, spanDays } from '../src/state';
import { stateFromParams, stateToParams } from '../src/lib/urlState';
import { mergeResponses, monthQueries } from '../src/api/acrossMonths';
import type { InboundQuery, InboundResponse } from '../src/api/types';

const flex = { dateMode: 'flex' as const, month: '2026-11', monthTo: '' };

describe('departWindow', () => {
  it('is null for every day of the chosen months and for exact dates', () => {
    expect(departWindow({ ...flex, departFrom: 1, departTo: END_OF_SPAN })).toBeNull();
    expect(departWindow({ ...flex, departFrom: 1, departTo: 30 })).toBeNull();
    expect(departWindow({ ...flex, monthTo: '2027-01', departFrom: 1, departTo: END_OF_SPAN })).toBeNull();
    expect(departWindow({ ...flex, dateMode: 'exact', departFrom: 12, departTo: 23 })).toBeNull();
  });

  it('turns days into dates, clamped to the month', () => {
    expect(departWindow({ ...flex, departFrom: 12, departTo: 23 })).toEqual({ from: '2026-11-12', to: '2026-11-23' });
    expect(departWindow({ ...flex, month: '2027-02', departFrom: 20, departTo: 31 }))
      .toEqual({ from: '2027-02-20', to: '2027-02-28' });
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('counts days on into later months when the search spans several', () => {
    const span = { ...flex, monthTo: '2027-01' };
    expect(searchMonths(span)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(spanDays(span)).toBe(30 + 31 + 31);
    // Day 20 is 20 Nov; day 35 is 5 Dec.
    expect(departWindow({ ...span, departFrom: 20, departTo: 35 })).toEqual({ from: '2026-11-20', to: '2026-12-05' });
    // A monthTo before month is ignored.
    expect(searchMonths({ month: '2026-12', monthTo: '2026-11' })).toEqual(['2026-12']);
  });

  it('round-trips through the URL and ignores bad days', () => {
    const defaults = initialState();
    const state = { ...defaults, month: defaults.month, departFrom: 12, departTo: 40, monthTo: '' };
    const params = stateToParams(state, defaults);
    expect(params.get('dayFrom')).toBe('12');
    expect(params.get('dayTo')).toBe('40');
    expect(stateFromParams(params, defaults)).toEqual(state);
    const bad = stateFromParams(new URLSearchParams('dayFrom=0&dayTo=400&monthTo=1999-01'), defaults);
    expect([bad.departFrom, bad.departTo, bad.monthTo]).toEqual([1, END_OF_SPAN, '']);
  });
});

describe('searching across months', () => {
  const base: InboundQuery = {
    destination: 'LIS', trip: 'round', dateMode: 'flex', month: '2026-11', flexKind: 'weekend',
    length: 5, depart: '2026-11-12', returnDate: '2026-11-15',
  };

  it('leaves a single-month query alone', () => {
    expect(monthQueries(base)).toEqual([base]);
  });

  it('splits a span into one query per month with its share of the window', () => {
    const parts = monthQueries({ ...base, monthTo: '2027-01', departFrom: '2026-11-20', departTo: '2026-12-05' });
    expect(parts.map(p => [p.month, p.departFrom, p.departTo])).toEqual([
      ['2026-11', '2026-11-20', undefined],
      ['2026-12', undefined, '2026-12-05'],
    ]);
    expect(parts.every(p => p.monthTo === undefined)).toBe(true);
  });

  it('merges fares and airports from every month', () => {
    const response = (origin: string, stale: boolean): InboundResponse => ({
      destination: 'LIS', currency: 'EUR',
      fares: [{ origin, destination: 'LIS', price: 50, transfers: 0, airlines: [], departure_at: '2026-11-20',
        return_at: null, found_at: null, link: '' }],
      airports: { [origin]: { iata: origin, name: origin, city: origin, country: '', lat: 0, lon: 0 } },
      meta: { stale, cached: true },
    });
    const merged = mergeResponses([response('LYS', false), response('GVA', true)]);
    expect(merged.fares.map(f => f.origin)).toEqual(['LYS', 'GVA']);
    expect(Object.keys(merged.airports)).toEqual(['LYS', 'GVA']);
    expect(merged.meta?.stale).toBe(true);
  });
});
