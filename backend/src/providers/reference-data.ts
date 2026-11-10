import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AirportInfo, Place } from '../types.ts';

// Travelpayouts' free, token-less reference files (English names).
// https://support.travelpayouts.com/hc/en-us/articles/360018907280-Data-in-json-format
const DATA_FILES = ['airports', 'cities', 'countries', 'airlines'] as const;
type DataFile = (typeof DATA_FILES)[number];

interface Coordinates { lat: number; lon: number }
interface RawAirport {
  code: string; name: string | null; city_code: string; country_code: string;
  coordinates: Coordinates | null; flightable?: boolean; iata_type?: string;
}
interface RawCity {
  code: string; name: string | null; country_code: string;
  coordinates: Coordinates | null; has_flightable_airport?: boolean;
}
interface RawNamed { code: string; name: string | null }

export interface ReferenceDataOptions {
  baseUrl?: string;
  /** Directory for an on-disk copy, so restarts don't refetch about 10 MB. */
  cacheDir?: string;
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
}

/** Airport, city, country and airline lookups, loaded once and kept in memory. */
export class ReferenceData {
  private airportsByCode = new Map<string, RawAirport>();
  private citiesByCode = new Map<string, RawCity>();
  private countryNames = new Map<string, string>();
  private airlineNames = new Map<string, string>();
  private loading: Promise<void> | null = null;
  private loadedAt = 0;
  private readonly options: Required<ReferenceDataOptions>;

  constructor(options: ReferenceDataOptions = {}) {
    this.options = {
      baseUrl: 'https://api.travelpayouts.com/data/en',
      cacheDir: '.cache/reference',
      maxAgeMs: 7 * 86_400_000,
      fetchImpl: fetch,
      ...options,
    };
  }

  /** Builds an instance from already-parsed files (used by tests). */
  static fromRecords(records: Record<DataFile, unknown[]>): ReferenceData {
    const data = new ReferenceData();
    data.index(records);
    data.loadedAt = Date.now();
    return data;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loadedAt && Date.now() - this.loadedAt < this.options.maxAgeMs) return;
    this.loading ??= this.loadAll().finally(() => { this.loading = null; });
    return this.loading;
  }

  airlineName(code: string): string {
    return this.airlineNames.get(code) ?? code;
  }

  cityCodeOf(code: string): string {
    return this.airportsByCode.get(code)?.city_code ?? code;
  }

  /**
   * Metadata for an airport or city code. A city code that is also an airport
   * code (LIS) resolves to the airport; other city codes (PAR, LON) resolve to
   * the city centre.
   */
  describe(code: string): AirportInfo | null {
    const airport = this.airportsByCode.get(code);
    if (airport?.coordinates) {
      const city = this.citiesByCode.get(airport.city_code);
      return {
        iata: code,
        name: airport.name ?? code,
        city: city?.name ?? airport.name ?? code,
        country: this.countryNames.get(airport.country_code) ?? airport.country_code,
        country_code: airport.country_code,
        lat: airport.coordinates.lat,
        lon: airport.coordinates.lon,
      };
    }
    const city = this.citiesByCode.get(code);
    if (city?.coordinates) {
      return {
        iata: code,
        name: `${city.name ?? code} (all airports)`,
        city: city.name ?? code,
        country: this.countryNames.get(city.country_code) ?? city.country_code,
        country_code: city.country_code,
        lat: city.coordinates.lat,
        lon: city.coordinates.lon,
      };
    }
    return null;
  }

  /** Prefix search over codes, airport names and city names. */
  searchPlaces(term: string, limit: number): Place[] {
    const needle = term.toLowerCase();
    const scored: { place: Place; score: number }[] = [];
    const consider = (code: string, names: (string | null)[], type: Place['type']) => {
      const info = this.describe(code);
      if (!info) return;
      let score = -1;
      if (code.toLowerCase() === needle) score = 3;
      else if (names.some((name) => name?.toLowerCase().startsWith(needle))) score = 2;
      else if (names.some((name) => name?.toLowerCase().includes(' ' + needle))) score = 1;
      if (score >= 0) scored.push({ place: { ...info, type }, score: score + (type === 'city' ? 0.5 : 0) });
    };
    for (const city of this.citiesByCode.values()) {
      if (city.has_flightable_airport === false) continue;
      consider(city.code, [city.name], 'city');
    }
    for (const airport of this.airportsByCode.values()) {
      if (airport.flightable === false || (airport.iata_type && airport.iata_type !== 'airport')) continue;
      const cityName = this.citiesByCode.get(airport.city_code)?.name ?? null;
      consider(airport.code, [airport.name, cityName], 'airport');
    }
    scored.sort((a, b) => b.score - a.score || a.place.city.localeCompare(b.place.city));
    // A city and its same-code airport (LIS) would show twice; keep the first.
    const seen = new Set<string>();
    return scored.map((entry) => entry.place)
      .filter((place) => !seen.has(place.iata) && seen.add(place.iata))
      .slice(0, limit);
  }

  private async loadAll(): Promise<void> {
    const entries = await Promise.all(DATA_FILES.map(async (file) => [file, await this.loadFile(file)] as const));
    this.index(Object.fromEntries(entries) as Record<DataFile, unknown[]>);
    this.loadedAt = Date.now();
  }

  private async loadFile(file: DataFile): Promise<unknown[]> {
    const cachePath = path.join(this.options.cacheDir, `${file}.json`);
    try {
      const info = await stat(cachePath);
      if (Date.now() - info.mtimeMs < this.options.maxAgeMs) {
        return JSON.parse(await readFile(cachePath, 'utf8')) as unknown[];
      }
    } catch { /* no usable disk copy */ }
    const response = await this.options.fetchImpl(`${this.options.baseUrl}/${file}.json`);
    if (!response.ok) throw new Error(`reference data ${file}: HTTP ${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text) as unknown[];
    await mkdir(this.options.cacheDir, { recursive: true }).catch(() => {});
    await writeFile(cachePath, text).catch(() => {});
    return parsed;
  }

  private index(records: Record<DataFile, unknown[]>): void {
    this.airportsByCode = new Map((records.airports as RawAirport[]).map((a) => [a.code, a]));
    this.citiesByCode = new Map((records.cities as RawCity[]).map((c) => [c.code, c]));
    this.countryNames = new Map((records.countries as RawNamed[]).map((c) => [c.code, c.name ?? c.code]));
    this.airlineNames = new Map((records.airlines as RawNamed[])
      .filter((a) => a.name).map((a) => [a.code, a.name as string]));
  }
}
