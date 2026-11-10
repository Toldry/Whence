import type { AirportInfo, Fare, FareProvider, InboundQuery, InboundResult, Place } from '../types.ts';
import { AIRLINE_POOL, AIRPORTS, COUNTRY_CODES, DESTINATIONS, LIS_FARES } from './mock-data.ts';
import type { MockAirport, MockDestination, MockFare } from './mock-data.ts';

/**
 * Deterministic fake fares, ported from the design prototype. Needs no token,
 * so the front end can integrate before Travelpayouts credentials exist.
 * Set `failNext` or `delayMs` to exercise loading and error states.
 */
export class MockProvider implements FareProvider {
  readonly name = 'mock';
  private readonly options: { delayMs?: number; now?: () => number };
  constructor(options: { delayMs?: number; now?: () => number } = {}) {
    this.options = options;
  }

  async searchInbound(query: InboundQuery): Promise<InboundResult> {
    if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    const now = this.options.now?.() ?? Date.now();
    const destination = DESTINATIONS.find((d) => d.iata === query.destination);
    const airports: Record<string, AirportInfo> = {};
    if (!destination) return { destination: query.destination, currency: 'EUR', fares: [], airports };
    airports[destination.iata] = describe(destination);

    const month = query.dateMode === 'exact' ? query.depart!.slice(0, 7) : query.month!;
    const kindFactor = query.dateMode === 'exact' ? 1.07 : query.flexKind === 'week' ? 0.96
      : query.flexKind === 'custom' ? ((query.length ?? 5) <= 2 ? 1.05 : (query.length ?? 5) >= 10 ? 0.97 : 1) : 1;
    const fares: Fare[] = [];
    for (const airport of AIRPORTS) {
      const km = distanceKm(airport, destination);
      if (airport.iata === destination.iata || km < 150) continue;
      const baseFares = destination.iata === 'LIS' ? LIS_FARES[airport.iata] ?? [] : generateFares(airport, destination);
      baseFares.forEach((base, index) => {
        const random = seededRandom(query.destination + airport.iata + month + (query.flexKind ?? '') + index);
        const multiplier = (MONTH_FACTOR[month.slice(5)] ?? 1) * kindFactor * (0.93 + random() * 0.14)
          * (query.trip === 'oneway' ? 0.58 : 1);
        const [departDate, returnDate] = pickDates(query, random, now);
        if (!departDate) return;
        fares.push({
          origin: airport.iata,
          destination: destination.iata,
          price: Math.max(19, Math.round(base.p * multiplier)),
          transfers: base.s,
          airlines: base.a,
          departure_at: departDate,
          return_at: returnDate,
          duration_minutes: flightMinutes(km, base.s),
          found_at: new Date(now - (base.h + Math.floor(random() * 4)) * 3_600_000).toISOString(),
          link: `https://www.aviasales.com/search/${airport.iata}${ddmm(departDate)}${destination.iata}${ddmm(returnDate)}1`,
        });
        airports[airport.iata] = describe(airport);
      });
    }
    return { destination: destination.iata, currency: 'EUR', fares, airports };
  }

  async searchPlaces(term: string, limit: number): Promise<Place[]> {
    const needle = term.toLowerCase();
    const places = new Map<string, Place>();
    for (const item of [...DESTINATIONS, ...AIRPORTS]) {
      const matches = item.iata.toLowerCase() === needle
        || item.city.toLowerCase().startsWith(needle) || item.airport.toLowerCase().startsWith(needle);
      if (matches && !places.has(item.iata)) places.set(item.iata, { ...describe(item), type: 'airport' });
    }
    return [...places.values()].slice(0, limit);
  }
}

function describe(item: MockAirport | MockDestination): AirportInfo {
  return {
    iata: item.iata, name: item.airport, city: item.city, country: item.country,
    country_code: COUNTRY_CODES[item.country] ?? '', lat: item.lat, lon: item.lon,
  };
}

const MONTH_FACTOR: Record<string, number> = {
  '01': 0.86, '02': 0.88, '03': 1, '04': 1.12, '05': 1.06, '06': 1.22,
  '07': 1.35, '08': 1.38, '09': 1.1, '10': 1, '11': 0.9, '12': 1.24,
};

function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

function flightMinutes(km: number, stops: number): number {
  const direct = 30 + (km / 800) * 60;
  return Math.round((stops ? direct * 1.3 + 100 : direct) / 5) * 5;
}

function generateFares(airport: MockAirport, destination: MockDestination): MockFare[] {
  const random = seededRandom('g' + airport.iata + destination.iata);
  const km = distanceKm(airport, destination);
  let base = (airport.land === 'na' ? 300 + km * 0.035 : 38 + km * 0.05) * (0.8 + random() * 0.5);
  const stops = (km > 2500 && random() < 0.5) || random() < 0.22 ? 1 : 0;
  if (stops) base *= 0.85;
  const pool = AIRLINE_POOL[airport.region] ?? ['Unknown'];
  const airlines = [pool[Math.floor(random() * pool.length)]!];
  if (random() < 0.35) {
    const second = pool[Math.floor(random() * pool.length)]!;
    if (second !== airlines[0]) airlines.push(second);
  }
  return [{ p: Math.round(base), s: stops, a: airlines, h: 3 + Math.floor(random() * 160) }];
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => isoDate(Date.parse(date + 'T00:00:00Z') + days * 86_400_000);
const ddmm = (date: string | null) => (date ? date.slice(8, 10) + date.slice(5, 7) : '');

function pickDates(query: InboundQuery, random: () => number, now: number): [string | null, string | null] {
  if (query.dateMode === 'exact') return [query.depart!, query.trip === 'oneway' ? null : query.return!];
  const [year, month] = query.month!.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const earliest = addDays(isoDate(now), 2);
  const wantedWeekday = query.flexKind === 'weekend' ? 5 : query.flexKind === 'week' ? 6 : -1;
  const stay = query.flexKind === 'weekend' ? 2 : query.flexKind === 'week' ? 7 : query.length ?? 5;
  const candidates: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = isoDate(Date.UTC(year, month - 1, day));
    if (date < earliest) continue;
    if (wantedWeekday < 0 || new Date(date + 'T00:00:00Z').getUTCDay() === wantedWeekday) candidates.push(date);
  }
  if (!candidates.length) return [null, null];
  const depart = candidates[Math.floor(random() * candidates.length)]!;
  return [depart, query.trip === 'oneway' ? null : addDays(depart, stay)];
}
