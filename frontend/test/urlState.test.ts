import { describe, expect, it } from 'vitest';
import { initialState, type AppState } from '../src/state';
import { stateFromParams, stateToParams } from '../src/lib/urlState';

const defaults = initialState();
const roundTrip = (state: AppState) => stateFromParams(new URLSearchParams(stateToParams(state, defaults).toString()), defaults);

describe('url state', () => {
  it('writes only the destination and active dates for the defaults', () => {
    const params = stateToParams(defaults, defaults);
    expect([...params.keys()].sort()).toEqual(['month', 'to']);
    expect(roundTrip(defaults)).toEqual(defaults);
  });

  it('round-trips filters, nested origin scope, arrays and nullables', () => {
    const state: AppState = {
      ...defaults,
      from: { ...defaults.from, type: 'near', city: 'Madrid', radiusKm: 300 },
      trip: 'oneway', dateMode: 'exact', depart: '2027-01-05',
      adults: 2, children: 1, cabin: 'Business', stops: '0', maxPrice: 250,
      airlines: ['TAP Air Portugal', 'Vueling'], maxDurationHours: 6,
      includeGround: false, sort: 'duration', currency: 'USD', mobileView: 'map',
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('keeps a cleared destination and a searched-for one', () => {
    expect(roundTrip({ ...defaults, destination: null }).destination).toBeNull();
    const destination = { iata: 'GDL', city: 'Guadalajara', country: 'Mexico', airport: 'Miguel Hidalgo', lat: 20.52, lon: -103.31 };
    expect(roundTrip({ ...defaults, destination }).destination).toEqual(destination);
  });

  it('ignores invalid values and leaves transient UI state alone', () => {
    const params = new URLSearchParams('trip=sideways&adults=lots&sort=bogus&currency=XYZ&month=1999-01&popover=pax&ground=maybe');
    expect(stateFromParams(params, defaults)).toEqual(defaults);
  });
});
