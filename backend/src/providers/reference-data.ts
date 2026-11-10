import type { AirportInfo, Place } from '../types.ts';

// Airport, city, country and airline lookups. The data comes from Travelpayouts'
// free reference files, slimmed by scripts/build-reference.ts into
// src/data/reference.json and bundled, so no file system or download is needed
// at runtime (the Worker has neither a disk nor time to fetch 10 MB).
// https://support.travelpayouts.com/hc/en-us/articles/360018907280-Data-in-json-format

/** [code, name, city_code, country_code, lat, lon, searchable (0 or 1)] */
export type SlimAirport = [string, string, string, string, number, number, 0 | 1];
/** [code, name, country_code, lat, lon, searchable (0 or 1)] */
export type SlimCity = [string, string, string, number, number, 0 | 1];

export interface SlimReference {
  airports: SlimAirport[];
  cities: SlimCity[];
  /** Country code to English name. */
  countries: Record<string, string>;
  /** Airline IATA code to name. */
  airlines: Record<string, string>;
}

interface Coordinates { lat: number; lon: number }
export interface RawAirport {
  code: string; name: string | null; city_code: string; country_code: string;
  coordinates: Coordinates | null; flightable?: boolean; iata_type?: string;
}
export interface RawCity {
  code: string; name: string | null; country_code: string;
  coordinates: Coordinates | null; has_flightable_airport?: boolean;
}
export interface RawNamed { code: string; name: string | null }
export interface RawReference {
  airports: RawAirport[]; cities: RawCity[]; countries: RawNamed[]; airlines: RawNamed[];
}

// About 10 m of precision is plenty for a map pin and keeps the file small.
const roundCoordinate = (value: number) => Math.round(value * 1e4) / 1e4;
const IATA_CODE = /^[A-Z]{3}$/;

/** Turns Travelpayouts' raw files into the slim bundled shape. */
export function slimReference(raw: RawReference): SlimReference {
  return {
    airports: raw.airports
      .filter((airport) => airport.coordinates && IATA_CODE.test(airport.code))
      .map((airport) => [
        airport.code, airport.name ?? '', airport.city_code, airport.country_code,
        roundCoordinate(airport.coordinates!.lat), roundCoordinate(airport.coordinates!.lon),
        airport.flightable === false || (airport.iata_type && airport.iata_type !== 'airport') ? 0 : 1,
      ]),
    cities: raw.cities
      .filter((city) => city.coordinates && IATA_CODE.test(city.code))
      .map((city) => [
        city.code, city.name ?? '', city.country_code,
        roundCoordinate(city.coordinates!.lat), roundCoordinate(city.coordinates!.lon),
        city.has_flightable_airport === false ? 0 : 1,
      ]),
    countries: Object.fromEntries(raw.countries.filter((c) => c.name).map((c) => [c.code, c.name!])),
    airlines: Object.fromEntries(raw.airlines.filter((a) => a.name).map((a) => [a.code, a.name!])),
  };
}

interface Airport {
  code: string; name: string; cityCode: string; countryCode: string;
  lat: number; lon: number; searchable: boolean;
}
interface City { code: string; name: string; countryCode: string; lat: number; lon: number; searchable: boolean }

export class ReferenceData {
  private readonly airportsByCode = new Map<string, Airport>();
  private readonly citiesByCode = new Map<string, City>();
  private readonly countryNames: Record<string, string>;
  private readonly airlineNames: Record<string, string>;

  constructor(data: SlimReference) {
    for (const [code, name, cityCode, countryCode, lat, lon, searchable] of data.airports) {
      this.airportsByCode.set(code, { code, name, cityCode, countryCode, lat, lon, searchable: searchable === 1 });
    }
    for (const [code, name, countryCode, lat, lon, searchable] of data.cities) {
      this.citiesByCode.set(code, { code, name, countryCode, lat, lon, searchable: searchable === 1 });
    }
    this.countryNames = data.countries;
    this.airlineNames = data.airlines;
  }

  /** Builds an instance from Travelpayouts' raw file shapes (used by tests). */
  static fromRecords(raw: RawReference): ReferenceData {
    return new ReferenceData(slimReference(raw));
  }

  /** Kept for the provider's call sites; bundled data is always loaded. */
  async ensureLoaded(): Promise<void> {}

  airlineName(code: string): string {
    return this.airlineNames[code] ?? code;
  }

  cityCodeOf(code: string): string {
    return this.airportsByCode.get(code)?.cityCode ?? code;
  }

  /**
   * Metadata for an airport or city code. A city code that is also an airport
   * code (LIS) resolves to the airport; other city codes (PAR, LON) resolve to
   * the city centre.
   */
  describe(code: string): AirportInfo | null {
    const airport = this.airportsByCode.get(code);
    if (airport) {
      const city = this.citiesByCode.get(airport.cityCode);
      return {
        iata: code,
        name: airport.name || code,
        city: city?.name || airport.name || code,
        country: this.countryNames[airport.countryCode] ?? airport.countryCode,
        country_code: airport.countryCode,
        lat: airport.lat,
        lon: airport.lon,
      };
    }
    const city = this.citiesByCode.get(code);
    if (city) {
      return {
        iata: code,
        name: `${city.name || code} (all airports)`,
        city: city.name || code,
        country: this.countryNames[city.countryCode] ?? city.countryCode,
        country_code: city.countryCode,
        lat: city.lat,
        lon: city.lon,
      };
    }
    return null;
  }

  /** Prefix search over codes, airport names and city names. */
  searchPlaces(term: string, limit: number): Place[] {
    const needle = term.toLowerCase();
    const scored: { code: string; type: Place['type']; score: number }[] = [];
    const consider = (code: string, names: string[], type: Place['type']) => {
      let score = -1;
      if (code.toLowerCase() === needle) score = 3;
      else if (names.some((name) => name.toLowerCase().startsWith(needle))) score = 2;
      else if (names.some((name) => name.toLowerCase().includes(' ' + needle))) score = 1;
      if (score >= 0) scored.push({ code, type, score: score + (type === 'city' ? 0.5 : 0) });
    };
    for (const city of this.citiesByCode.values()) {
      if (city.searchable) consider(city.code, [city.name], 'city');
    }
    for (const airport of this.airportsByCode.values()) {
      if (!airport.searchable) continue;
      consider(airport.code, [airport.name, this.citiesByCode.get(airport.cityCode)?.name ?? ''], 'airport');
    }
    const places = scored.map(({ code, type, score }) => ({ place: { ...this.describe(code)!, type }, score }));
    places.sort((a, b) => b.score - a.score || a.place.city.localeCompare(b.place.city));
    // A city and its same-code airport (LIS) would show twice; keep the first.
    const seen = new Set<string>();
    return places.map((entry) => entry.place)
      .filter((place) => !seen.has(place.iata) && seen.add(place.iata))
      .slice(0, limit);
  }
}
