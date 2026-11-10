/**
 * In-browser stand-in for the back end. Produces deterministic, plausible fares in the
 * exact shape of GET /api/inbound, so swapping in the HTTP source needs no UI changes.
 *
 * Demo switches via the page URL: ?mock=error | empty | slow
 */
import type { AirportInfo, Fare, FareSource, InboundQuery, InboundResponse } from './types';
import { distanceKm } from '../data/geo';
import { DESTINATIONS, DESTINATION_BY_IATA, MOCK_AIRPORTS } from '../data/places';

interface SeedFare {
  price: number;
  transfers: number;
  airlines: string[];
  /** Relative age seed, 0–160; mapped onto the 2–7 day cache window. */
  ageSeed: number;
}
const seed = (price: number, transfers: number, airlines: string[], ageSeed: number): SeedFare =>
  ({ price, transfers, airlines, ageSeed });

/** Hand-tuned Lisbon fares: round trip, economy, 1 adult, a weekend in March. */
const LISBON_SEEDS: Record<string, SeedFare[]> = {
  MAD: [seed(58, 0, ['TAP Air Portugal', 'Iberia'], 5)], BCN: [seed(49, 0, ['Vueling'], 30)],
  OPO: [seed(44, 0, ['TAP Air Portugal'], 52)], FNC: [seed(62, 0, ['easyJet', 'TAP Air Portugal'], 18)],
  PDL: [seed(79, 0, ['Azores Airlines', 'TAP Air Portugal'], 96)], LGW: [seed(56, 0, ['easyJet'], 9)],
  MAN: [seed(68, 0, ['Ryanair', 'easyJet'], 61)], EDI: [seed(84, 0, ['easyJet'], 140)],
  DUB: [seed(61, 0, ['Ryanair', 'Aer Lingus'], 22)], ORY: [seed(47, 0, ['Transavia'], 3)],
  LYS: [seed(126, 0, ['TAP Air Portugal'], 40), seed(98, 1, ['Vueling'], 75)],
  NCE: [seed(82, 0, ['easyJet', 'TAP Air Portugal'], 110)], GVA: [seed(64, 0, ['easyJet'], 14)],
  BRU: [seed(72, 0, ['Brussels Airlines', 'Ryanair'], 48)], AMS: [seed(79, 0, ['Transavia', 'KLM'], 12)],
  ZRH: [seed(131, 0, ['Swiss', 'TAP Air Portugal'], 26), seed(89, 1, ['Vueling'], 60)],
  FRA: [seed(118, 0, ['Lufthansa', 'TAP Air Portugal'], 33), seed(84, 1, ['Iberia'], 80)],
  MUC: [seed(124, 0, ['Lufthansa'], 7), seed(96, 1, ['Vueling'], 150)],
  BER: [seed(69, 0, ['Ryanair', 'easyJet'], 20)], VIE: [seed(98, 0, ['TAP Air Portugal', 'Austrian'], 44)],
  PRG: [seed(91, 1, ['Lufthansa'], 66)], WAW: [seed(94, 0, ['LOT'], 28)], KRK: [seed(73, 0, ['Ryanair'], 120)],
  BUD: [seed(86, 0, ['Wizz Air'], 16)], CPH: [seed(112, 0, ['SAS', 'TAP Air Portugal'], 38)],
  ARN: [seed(121, 1, ['SAS'], 90)], OSL: [seed(134, 0, ['Norwegian'], 57)],
  HEL: [seed(168, 1, ['Finnair', 'Iberia'], 160)], FCO: [seed(76, 0, ['ITA Airways', 'Ryanair'], 11)],
  MXP: [seed(57, 0, ['easyJet'], 24)], ATH: [seed(142, 0, ['Aegean'], 70)],
  IST: [seed(184, 0, ['Turkish Airlines'], 36), seed(151, 1, ['Pegasus', 'Vueling'], 100)],
  JFK: [seed(412, 0, ['TAP Air Portugal', 'Delta'], 19), seed(358, 1, ['Iberia'], 54)],
  BOS: [seed(376, 0, ['TAP Air Portugal'], 42)], IAD: [seed(431, 0, ['TAP Air Portugal', 'United'], 88)],
  MIA: [seed(468, 0, ['TAP Air Portugal'], 130)], ORD: [seed(497, 0, ['TAP Air Portugal', 'United'], 64)],
  SFO: [seed(562, 0, ['TAP Air Portugal'], 150)], LAX: [seed(598, 1, ['Delta', 'Air France'], 77)],
  YYZ: [seed(449, 0, ['Air Transat'], 31)], YUL: [seed(426, 0, ['Air Transat', 'Air Canada'], 58)],
};

/** Which airline pool and price curve a mock origin uses. */
const MARKET_BY_COUNTRY: Record<string, string> = {
  Spain: 'iberia', Portugal: 'iberia',
  'United Kingdom': 'british', Ireland: 'british',
  France: 'western', Belgium: 'western', Netherlands: 'western', Luxembourg: 'western',
  Switzerland: 'central', Germany: 'central', Austria: 'central', Czechia: 'central',
  Poland: 'central', Hungary: 'central', Slovakia: 'central',
  Denmark: 'nordic', Sweden: 'nordic', Norway: 'nordic', Finland: 'nordic', Iceland: 'nordic',
  Italy: 'southern', Greece: 'southern', 'Türkiye': 'southern', Malta: 'southern', Croatia: 'southern',
  'United States': 'na', Canada: 'na',
};

const AIRLINE_POOL_BY_REGION: Record<string, string[]> = {
  iberia: ['Iberia', 'Vueling', 'TAP Air Portugal', 'Ryanair'],
  british: ['easyJet', 'Ryanair', 'British Airways', 'Aer Lingus'],
  western: ['Air France', 'Transavia', 'KLM', 'easyJet', 'Brussels Airlines'],
  central: ['Lufthansa', 'Eurowings', 'Ryanair', 'Wizz Air', 'LOT', 'Austrian'],
  nordic: ['SAS', 'Norwegian', 'Finnair'],
  southern: ['ITA Airways', 'Aegean', 'Ryanair', 'Turkish Airlines'],
  na: ['Delta', 'United', 'American Airlines', 'Air Canada', 'Air Transat'],
};

const MONTH_MULTIPLIER: Record<string, number> = {
  '01': 0.86, '02': 0.88, '03': 1, '04': 1.12, '05': 1.06, '06': 1.22,
  '07': 1.35, '08': 1.38, '09': 1.1, '10': 1, '11': 0.9, '12': 1.24,
};

const HOUR_MS = 3_600_000;
const MIN_CACHE_AGE_HOURS = 48;
const CACHE_AGE_SPAN_HOURS = 120;

function seededRandom(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const isoDate = (y: number, monthIndex: number, d: number) =>
  new Date(Date.UTC(y, monthIndex, d)).toISOString().slice(0, 10);
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const ddmm = (date: string | null) => (date ? date.slice(8, 10) + date.slice(5, 7) : '');

function pickDates(query: InboundQuery, random: () => number): [string, string | null] {
  if (query.dateMode === 'exact') return [query.depart, query.trip === 'oneway' ? null : query.returnDate];
  const [year, month] = query.month.split('-').map(Number);
  const monthIndex = month - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const earliest = addDays(new Date().toISOString().slice(0, 10), 2);
  const wantedWeekday = query.flexKind === 'weekend' ? 5 : query.flexKind === 'week' ? 6 : -1;
  const span = query.flexKind === 'weekend' ? 2 : query.flexKind === 'week' ? 7 : query.length;
  const candidates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = isoDate(year, monthIndex, d);
    if (date < earliest) continue;
    if ((query.departFrom && date < query.departFrom) || (query.departTo && date > query.departTo)) continue;
    if (wantedWeekday < 0 || new Date(`${date}T00:00:00Z`).getUTCDay() === wantedWeekday) candidates.push(date);
  }
  const depart = candidates.length ? candidates[Math.floor(random() * candidates.length)] : earliest;
  return [depart, query.trip === 'oneway' ? null : addDays(depart, span)];
}

function generatedSeeds(origin: AirportInfo, destination: { iata: string; lat: number; lon: number }): SeedFare[] {
  const random = seededRandom('g' + origin.iata + destination.iata);
  const km = distanceKm(origin, destination);
  const region = MARKET_BY_COUNTRY[origin.country] ?? 'western';
  let base = (region === 'na' ? 300 + km * 0.035 : 38 + km * 0.05) * (0.8 + random() * 0.5);
  const transfers = (km > 2500 && random() < 0.5) || random() < 0.22 ? 1 : 0;
  if (transfers) base *= 0.85;
  const pool = AIRLINE_POOL_BY_REGION[region];
  const airlines = [pool[Math.floor(random() * pool.length)]];
  if (random() < 0.35) {
    const second = pool[Math.floor(random() * pool.length)];
    if (second !== airlines[0]) airlines.push(second);
  }
  return [seed(Math.round(base), transfers, airlines, Math.floor(random() * 160))];
}

function buildResponse(query: InboundQuery, mode: string | null): InboundResponse {
  const destination = DESTINATION_BY_IATA[query.destination];
  const empty: InboundResponse = { destination: query.destination, currency: 'EUR', fares: [], airports: {} };
  if (!destination || mode === 'empty') return empty;

  const month = query.dateMode === 'exact' ? query.depart.slice(0, 7) : query.month;
  const lengthFactor = query.dateMode === 'exact' ? 1.07
    : query.flexKind === 'week' ? 0.96
      : query.flexKind === 'custom' ? (query.length <= 2 ? 1.05 : query.length >= 10 ? 0.97 : 1) : 1;
  const now = Date.now();
  const fares: Fare[] = [];
  const airports: Record<string, AirportInfo> = {
    [destination.iata]: {
      iata: destination.iata, name: destination.airport, city: destination.city,
      country: destination.country, lat: destination.lat, lon: destination.lon,
    },
  };

  for (const origin of MOCK_AIRPORTS) {
    if (origin.iata === destination.iata || distanceKm(origin, destination) < 150) continue;
    const seeds = destination.iata === 'LIS' ? LISBON_SEEDS[origin.iata] ?? [] : generatedSeeds(origin, destination);
    seeds.forEach((s, index) => {
      const random = seededRandom(query.destination + origin.iata + month + query.flexKind + index);
      const multiplier = (MONTH_MULTIPLIER[month.slice(5)] ?? 1) * lengthFactor
        * (0.93 + random() * 0.14) * (query.trip === 'oneway' ? 0.58 : 1);
      const [departure, returnDate] = pickDates(query, random);
      const ageHours = MIN_CACHE_AGE_HOURS + (s.ageSeed / 160) * CACHE_AGE_SPAN_HOURS + random() * 4;
      fares.push({
        origin: origin.iata,
        destination: destination.iata,
        price: Math.max(19, Math.round(s.price * multiplier)),
        transfers: s.transfers,
        airlines: s.airlines,
        departure_at: departure,
        return_at: returnDate,
        duration_minutes: null,
        found_at: new Date(now - ageHours * HOUR_MS).toISOString(),
        link: `https://www.aviasales.com/search/${origin.iata}${ddmm(departure)}${destination.iata}${ddmm(returnDate)}1`,
      });
      airports[origin.iata] = origin;
    });
  }
  return { destination: destination.iata, currency: 'EUR', fares, airports };
}

export function createMockFareSource(): FareSource {
  return {
    searchInbound(query, signal) {
      const mode = new URLSearchParams(window.location.search).get('mock');
      const delayMs = mode === 'slow' ? 4000 : 650 + Math.random() * 400;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (mode === 'error') reject(new Error('Fare cache unavailable'));
          else resolve(buildResponse(query, mode));
        }, delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    },
    async searchPlaces(text) {
      const needle = text.trim().toLowerCase();
      return DESTINATIONS
        .filter(d => !needle || [d.city, d.iata, d.country, d.airport].some(v => v.toLowerCase().includes(needle)))
        .map(d => ({ iata: d.iata, name: d.airport, city: d.city, country: d.country, lat: d.lat, lon: d.lon, type: 'airport' }));
    },
  };
}
