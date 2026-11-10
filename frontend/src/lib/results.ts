/**
 * Turns a raw InboundResponse plus the user's filters into one row per origin airport.
 * Pure and UI-free so it can be unit-tested and reused by the list, the map and empty states.
 */
import type { AirportInfo, Fare, InboundResponse, TripType } from '../api/types';
import { distanceKm, estimateFlightMinutes, estimateGround, type GroundEstimate, type LatLon } from '../data/geo';
import type { HomeCity } from '../data/places';
import { countryCodeOf, regionsOfCountry } from '../data/regions';

export type OriginScope =
  | { type: 'anywhere' }
  /** Continent or subregion keys; an airport matches if it is in any of them. */
  | { type: 'region'; regions: string[] }
  /** ISO 3166 alpha-2 codes. */
  | { type: 'country'; countries: string[] }
  | { type: 'near'; lat: number; lon: number; radiusKm: number };

export type StopsFilter = 'any' | '0' | '1';
export type SortKey = 'total' | 'price' | 'duration' | 'date' | 'fresh';

export const CABIN_MULTIPLIER: Record<string, number> = {
  Economy: 1, 'Premium economy': 1.6, Business: 3.1, First: 5.2,
};

export interface Travellers {
  adults: number;
  children: number;
  infants: number;
}

export interface ResultFilters {
  scope: OriginScope;
  stops: StopsFilter;
  /**
   * In EUR, after cabin and passenger scaling. Caps the flight price, or the total
   * trip cost (flight plus getting to the airport) when a home city is set.
   */
  maxPrice: number | null;
  airlines: string[];
  maxDurationHours: number | null;
  /** Inclusive YYYY-MM-DD bounds on the departure date; null or absent allows any. */
  departWindow?: { from: string; to: string } | null;
}

export interface ResultContext {
  response: InboundResponse | null;
  destination: LatLon | null;
  trip: TripType;
  cabin: string;
  travellers: Travellers;
  /** Home city for the "getting to the airport" estimate, or null when the toggle is off. */
  home: HomeCity | null;
  now: number;
}

export interface FareOption {
  fare: Fare;
  airport: AirportInfo;
  km: number;
  durationMinutes: number;
  /** Flight price for the whole party, EUR. */
  flight: number;
  ageHours: number | null;
  /** The hub when the fare is a self-transfer on separate tickets, else null. */
  via: AirportInfo | null;
}

export interface OriginRow extends FareOption {
  ground: GroundEstimate | null;
  /** Ground cost for the whole party, both ways on round trips, EUR. */
  groundCost: number;
  total: number;
  /** The value the list and map rank on: total when home is set, otherwise flight. */
  value: number;
  /** A nonstop alternative when the cheapest option has a stop. */
  nonstopAlternative: FareOption | null;
  /** 0 (cheapest fifth) to 4 (priciest fifth). */
  tier: number;
}

export function passengerFactor(t: Travellers): number {
  return t.adults + t.children * 0.85 + t.infants * 0.12;
}
export function groundPassengerFactor(t: Travellers): number {
  return t.adults + t.children * 0.6;
}

function inScope(airport: AirportInfo, scope: OriginScope): boolean {
  switch (scope.type) {
    case 'anywhere': return true;
    case 'region': return regionsOfCountry(countryCodeOf(airport)).some(r => scope.regions.includes(r));
    case 'country': {
      const code = countryCodeOf(airport);
      return !!code && scope.countries.includes(code);
    }
    case 'near': return distanceKm(scope, airport) <= scope.radiusKm;
  }
}

/** Every fare for the destination, scaled for cabin and party, with no filters applied. */
export function fareOptions(ctx: ResultContext): FareOption[] {
  const { response, destination } = ctx;
  if (!response || !destination) return [];
  const scale = (CABIN_MULTIPLIER[ctx.cabin] ?? 1) * passengerFactor(ctx.travellers);
  const options: FareOption[] = [];
  for (const fare of response.fares) {
    const airport = response.airports[fare.origin];
    if (!airport) continue;
    const km = distanceKm(airport, destination);
    options.push({
      fare, airport, km,
      durationMinutes: fare.duration_minutes ?? estimateFlightMinutes(km, fare.transfers),
      flight: fare.price * scale,
      ageHours: fare.found_at ? (ctx.now - Date.parse(fare.found_at)) / 3.6e6 : null,
      via: fare.self_transfer ? response.airports[fare.self_transfer.via] ?? null : null,
    });
  }
  return options;
}

/** Getting to `airport` from the home city for the whole party, both ways on round trips. */
function groundFor(ctx: ResultContext, airport: AirportInfo): { ground: GroundEstimate | null; groundCost: number } {
  if (!ctx.home) return { ground: null, groundCost: 0 };
  const ground = estimateGround(ctx.home, airport);
  return { ground, groundCost: ground.cost * (ctx.trip === 'round' ? 2 : 1) * groundPassengerFactor(ctx.travellers) };
}

export function computeRows(ctx: ResultContext, filters: ResultFilters): OriginRow[] {
  const byOrigin = new Map<string, FareOption[]>();
  const groundByOrigin = new Map<string, ReturnType<typeof groundFor>>();
  for (const option of fareOptions(ctx)) {
    if (!inScope(option.airport, filters.scope)) continue;
    if (filters.departWindow) {
      const departDate = option.fare.departure_at.slice(0, 10);
      if (departDate < filters.departWindow.from || departDate > filters.departWindow.to) continue;
    }
    if (filters.stops === '0' && option.fare.transfers > 0) continue;
    if (filters.stops === '1' && option.fare.transfers > 1) continue;
    const iata = option.airport.iata;
    if (!groundByOrigin.has(iata)) groundByOrigin.set(iata, groundFor(ctx, option.airport));
    const { groundCost } = groundByOrigin.get(iata)!;
    if (filters.maxPrice != null && option.flight + groundCost > filters.maxPrice) continue;
    if (filters.maxDurationHours != null && option.durationMinutes > filters.maxDurationHours * 60) continue;
    if (filters.airlines.length && !option.fare.airlines.some(a => filters.airlines.includes(a))) continue;
    const list = byOrigin.get(option.airport.iata) ?? [];
    list.push(option);
    byOrigin.set(option.airport.iata, list);
  }

  const rows: OriginRow[] = [];
  for (const options of byOrigin.values()) {
    options.sort((a, b) => a.flight - b.flight);
    const best = options[0];
    const nonstopAlternative = best.fare.transfers > 0 ? options.find(o => o.fare.transfers === 0) ?? null : null;
    const { ground, groundCost } = groundByOrigin.get(best.airport.iata)!;
    const total = best.flight + groundCost;
    rows.push({ ...best, ground, groundCost, total, value: ctx.home ? total : best.flight, nonstopAlternative, tier: 0 });
  }
  assignTiers(rows);
  return rows;
}

const PALETTE_SIZE = 5;

/** Palette slot for price bin `bin` of `binCount`: cheapest is always green, dearest always red. */
export function tierForBin(bin: number, binCount: number): number {
  return binCount <= 1 ? 0 : Math.round(bin * (PALETTE_SIZE - 1) / (binCount - 1));
}

/**
 * Splits row values into up to five quintile bins and sets each row's palette tier.
 * Returns the bins' lower bounds, cheapest first. Thresholds that repeat or that equal
 * the cheapest value are merged, so the bins and the legend always rise strictly.
 */
export function assignTiers(rows: OriginRow[]): number[] {
  const values = rows.map(r => r.value).sort((a, b) => a - b);
  if (!values.length) return [];
  const quantile = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
  const thresholds: number[] = [];
  for (const t of [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8)]) {
    // Compare whole euros so two bins never show the same legend label.
    if (Math.round(t) > Math.round(thresholds.at(-1) ?? values[0])) thresholds.push(t);
  }
  const binCount = thresholds.length + 1;
  for (const row of rows) row.tier = tierForBin(thresholds.filter(t => row.value >= t).length, binCount);
  return [values[0], ...thresholds];
}

const UNKNOWN_AGE = Number.POSITIVE_INFINITY;
export const SORTERS: Record<SortKey, (a: OriginRow, b: OriginRow) => number> = {
  total: (a, b) => a.total - b.total,
  price: (a, b) => a.flight - b.flight,
  duration: (a, b) => a.durationMinutes - b.durationMinutes,
  date: (a, b) => (Date.parse(a.fare.departure_at) - Date.parse(b.fare.departure_at)) || a.flight - b.flight,
  fresh: (a, b) => (a.ageHours ?? UNKNOWN_AGE) - (b.ageHours ?? UNKNOWN_AGE),
};

/** Prices older than this get a warning on the row. */
export const STALE_ROW_HOURS = 6 * 24;
/** When the median age passes this, the list shows a banner. */
export const STALE_LIST_HOURS = 7 * 24;
