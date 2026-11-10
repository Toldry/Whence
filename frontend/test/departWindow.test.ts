import { describe, expect, it } from 'vitest';
import { daysInMonth, departWindow, initialState } from '../src/state';
import { stateFromParams, stateToParams } from '../src/lib/urlState';

const flex = { dateMode: 'flex' as const, month: '2026-11' };

describe('departWindow', () => {
  it('is null for the whole month and for exact dates', () => {
    expect(departWindow({ ...flex, departFrom: 1, departTo: 31 })).toBeNull();
    expect(departWindow({ ...flex, departFrom: 1, departTo: 30 })).toBeNull();
    expect(departWindow({ ...flex, dateMode: 'exact', departFrom: 12, departTo: 23 })).toBeNull();
  });

  it('turns days into dates, clamped to the month', () => {
    expect(departWindow({ ...flex, departFrom: 12, departTo: 23 })).toEqual({ from: '2026-11-12', to: '2026-11-23' });
    expect(departWindow({ ...flex, month: '2027-02', departFrom: 20, departTo: 31 }))
      .toEqual({ from: '2027-02-20', to: '2027-02-28' });
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('round-trips through the URL and ignores bad days', () => {
    const defaults = initialState();
    const state = { ...defaults, departFrom: 12, departTo: 23 };
    const params = stateToParams(state, defaults);
    expect(params.get('dayFrom')).toBe('12');
    expect(params.get('dayTo')).toBe('23');
    expect(stateFromParams(params, defaults)).toEqual(state);
    const bad = stateFromParams(new URLSearchParams('dayFrom=0&dayTo=40'), defaults);
    expect([bad.departFrom, bad.departTo]).toEqual([1, 31]);
  });
});
