import { describe, expect, it } from 'vitest';
import { initialState, type AppState } from '../src/state';
import { stateFromParams, stateToParams } from '../src/lib/urlState';
import { HOME_BY_NAME } from '../src/data/places';

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
      from: { ...defaults.from, type: 'near', city: 'Madrid', cityLat: 40.417, cityLon: -3.704, radiusKm: 300 },
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

  it('keeps a preset home by name and a searched-for one with its position', () => {
    const preset = stateToParams({ ...defaults, home: HOME_BY_NAME.Paris }, defaults);
    expect(preset.get('home')).toBe('Paris');
    expect(preset.has('homeLat')).toBe(false);
    expect(roundTrip({ ...defaults, home: HOME_BY_NAME.Paris }).home).toEqual(HOME_BY_NAME.Paris);
    const home = { name: 'Grenoble', country: 'France', lat: 45.19, lon: 5.72 };
    expect(roundTrip({ ...defaults, home }).home).toEqual(home);
    const palma = { name: 'Palma', iata: 'PMI', country: 'Spain', lat: 39.57, lon: 2.65 };
    expect(roundTrip({ ...defaults, home: palma }).home).toEqual(palma);
    expect(stateFromParams(new URLSearchParams('home=Nowhere'), defaults).home).toEqual(defaults.home);
  });

  it('round-trips several regions and countries as comma lists', () => {
    const from = { ...defaults.from, type: 'country' as const, regions: ['europe', 'caribbean'], countries: ['ES', 'PT'] };
    const params = stateToParams({ ...defaults, from }, defaults);
    expect(params.get('fromCountries')).toBe('ES,PT');
    expect(params.get('fromRegions')).toBe('europe,caribbean');
    expect(roundTrip({ ...defaults, from }).from).toEqual(from);
  });

  it('drops unknown regions and countries but keeps the rest', () => {
    const state = stateFromParams(new URLSearchParams('fromType=country&fromCountries=ES,XX,pt,FR&fromRegions=atlantis,polynesia'), defaults);
    expect(state.from.countries).toEqual(['ES', 'FR']);
    expect(state.from.regions).toEqual(['polynesia']);
  });

  it('reads links made with the old single region, country and preset city', () => {
    const state = stateFromParams(new URLSearchParams('fromType=region&fromRegion=nordic&fromCountry=Spain&fromCity=Madrid'), defaults);
    expect(state.from.regions).toEqual(['northern-europe']);
    expect(state.from.countries).toEqual(['ES']);
    expect([state.from.city, state.from.cityLat, state.from.cityLon]).toEqual(['Madrid', HOME_BY_NAME.Madrid.lat, HOME_BY_NAME.Madrid.lon]);
  });

  it('ignores invalid values and leaves transient UI state alone', () => {
    const params = new URLSearchParams('trip=sideways&adults=lots&sort=bogus&currency=XYZ&month=1999-01&popover=pax&ground=maybe');
    expect(stateFromParams(params, defaults)).toEqual(defaults);
  });
});
