import { describe, expect, it } from 'vitest';
import {
  CONTINENTS, COUNTRIES, countryCodeOf, isRegionSelected, normalizeRegions, REGION_BY_KEY,
  searchCountries, SUBREGIONS, SUBREGIONS_OF, summarizeNames, toggleRegion,
} from '../src/data/regions';
import { MOCK_AIRPORTS } from '../src/data/places';

describe('regions and countries', () => {
  it('puts every country in a known subregion, and every subregion has countries', () => {
    expect(COUNTRIES.length).toBeGreaterThan(200);
    for (const country of COUNTRIES) {
      expect(REGION_BY_KEY[country.subregion]?.parent, country.code).toBe(country.continent);
    }
    for (const sub of SUBREGIONS) expect(COUNTRIES.some(c => c.subregion === sub.key), sub.key).toBe(true);
    expect(CONTINENTS).toHaveLength(5);
  });

  it('knows the country of every mock airport, which carries only a name', () => {
    for (const airport of MOCK_AIRPORTS) expect(countryCodeOf(airport), airport.country).toBeTruthy();
  });

  it('searches names, aliases and codes, ignoring accents', () => {
    expect(searchCountries('spa')[0].code).toBe('ES');
    expect(searchCountries('uk')[0].code).toBe('GB');
    expect(searchCountries('turkey')[0].code).toBe('TR');
    expect(searchCountries('reunion')[0].code).toBe('RE');
    expect(searchCountries('de')[0].code).toBe('DE');
    expect(searchCountries('zealand').map(c => c.code)).toContain('NZ');
    expect(searchCountries('qqq')).toEqual([]);
  });

  it('folds a full set of subregions into the continent and splits it again', () => {
    const allEurope = SUBREGIONS_OF.europe;
    expect(normalizeRegions(allEurope)).toEqual(['europe']);
    const split = toggleRegion(['europe'], 'eastern-europe');
    expect(split.sort()).toEqual(['northern-europe', 'southern-europe', 'western-europe']);
    expect(toggleRegion(split, 'eastern-europe')).toEqual(['europe']);
    expect(isRegionSelected(['europe'], 'western-europe')).toBe(true);
    expect(isRegionSelected(['caribbean'], 'western-europe')).toBe(false);
  });

  it('summarizes long picks', () => {
    expect(summarizeNames(['Spain'])).toBe('Spain');
    expect(summarizeNames(['Spain', 'Portugal'])).toBe('Spain and Portugal');
    expect(summarizeNames(['Spain', 'Portugal', 'France'])).toBe('Spain + 2 more');
  });
});
