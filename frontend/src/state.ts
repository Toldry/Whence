import type { DateMode, FlexKind, TripType } from './api/types';
import type { Destination, HomeCity } from './data/places';
import { DESTINATION_BY_IATA, HOME_BY_NAME } from './data/places';
import type { OriginScope, SortKey, StopsFilter } from './lib/results';
import type { FitRequest, FocusPoint } from './components/InboundMap';

export type PopoverKey =
  | 'currency' | 'trip' | 'pax' | 'cabin' | 'from' | 'to' | 'dates'
  | 'stops' | 'price' | 'airlines' | 'duration' | 'home' | 'sort' | 'groundInfo';

export interface FromState {
  type: OriginScope['type'];
  /** Continent or subregion keys from data/regions.ts. */
  regions: string[];
  /** ISO 3166 alpha-2 codes. */
  countries: string[];
  /** Centre of the "near a city" circle. */
  city: string;
  cityLat: number;
  cityLon: number;
  radiusKm: number;
}

export interface AppState {
  destination: Destination | null;
  from: FromState;
  trip: TripType;
  dateMode: DateMode;
  flexKind: FlexKind;
  month: string;
  length: number;
  /** Last month of a flexible search spanning several months; '' when it covers `month` alone. */
  monthTo: string;
  /**
   * First and last allowed departure day (flex mode), counted from the 1st of `month`, so
   * 35 is the 4th or 5th of the next month. Values past the span's end are clamped to it.
   */
  departFrom: number;
  departTo: number;
  depart: string;
  returnDate: string;
  adults: number;
  children: number;
  infants: number;
  cabin: string;
  stops: StopsFilter;
  maxPrice: number | null;
  airlines: string[];
  maxDurationHours: number | null;
  includeGround: boolean;
  /** Where the "getting to the airport" estimate starts: a preset or any searched-for city. */
  home: HomeCity;
  sort: SortKey;
  currency: string;
  hoverId: string | null;
  selectedId: string | null;
  focusPoint: FocusPoint | null;
  fitRequest: FitRequest | null;
  popover: PopoverKey | null;
  /** Small screens show either the list or the map. */
  mobileView: 'list' | 'map';
}

export type StatePatch = Partial<AppState> | ((s: AppState) => Partial<AppState>);
export interface Store {
  state: AppState;
  set(patch: StatePatch): void;
  togglePopover(key: PopoverKey): void;
  closePopover(): void;
}

/** The next eight calendar months, starting with the current one. */
export function upcomingMonths(today = new Date()): string[] {
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** A departTo that always means "to the end of the last month". */
export const END_OF_SPAN = 366;

export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + count, 1)).toISOString().slice(0, 7);
}

/** The months a flexible search covers, first to last (at most a year). */
export function searchMonths(s: Pick<AppState, 'month' | 'monthTo'>): string[] {
  const months = [s.month];
  while (s.monthTo > months[months.length - 1] && months.length < 12) {
    months.push(addMonths(months[months.length - 1], 1));
  }
  return months;
}

/** Number of days in the months a flexible search covers. */
export function spanDays(s: Pick<AppState, 'month' | 'monthTo'>): number {
  return searchMonths(s).reduce((sum, month) => sum + daysInMonth(month), 0);
}

/** YYYY-MM-DD of day `index` (1-based) counted from the 1st of `month`. */
export function dateOfSpanDay(month: string, index: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCDate(index);
  return date.toISOString().slice(0, 10);
}

/** departFrom and departTo clamped to the span, so that 1 <= from <= to <= spanDays. */
export function spanBounds(
  s: Pick<AppState, 'month' | 'monthTo' | 'departFrom' | 'departTo'>,
): { fromIndex: number; toIndex: number; total: number } {
  const total = spanDays(s);
  const fromIndex = Math.min(Math.max(1, s.departFrom), total);
  const toIndex = Math.min(Math.max(fromIndex, s.departTo), total);
  return { fromIndex, toIndex, total };
}

export interface DepartWindow {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
}

/**
 * The flexible-dates departure window as dates, or null when it covers every day of the
 * chosen months (or the dates are exact).
 */
export function departWindow(
  s: Pick<AppState, 'dateMode' | 'month' | 'monthTo' | 'departFrom' | 'departTo'>,
): DepartWindow | null {
  if (s.dateMode !== 'flex') return null;
  const { fromIndex, toIndex, total } = spanBounds(s);
  if (fromIndex <= 1 && toIndex >= total) return null;
  return { from: dateOfSpanDay(s.month, fromIndex), to: dateOfSpanDay(s.month, toIndex) };
}

export function scopeFromState(from: FromState): OriginScope {
  switch (from.type) {
    // Nothing picked yet means no limit, so opening a tab never empties the list.
    case 'region': return from.regions.length ? { type: 'region', regions: from.regions } : { type: 'anywhere' };
    case 'country': return from.countries.length ? { type: 'country', countries: from.countries } : { type: 'anywhere' };
    case 'near': return { type: 'near', lat: from.cityLat, lon: from.cityLon, radiusKm: from.radiusKm };
    default: return { type: 'anywhere' };
  }
}

export function initialState(): AppState {
  const months = upcomingMonths();
  const month = months[4];
  return {
    destination: DESTINATION_BY_IATA.LIS,
    from: {
      type: 'anywhere', regions: [], countries: [], city: 'Paris', cityLat: 48.857, cityLon: 2.352, radiusKm: 600,
    },
    trip: 'round', dateMode: 'flex', flexKind: 'weekend', month, length: 5,
    monthTo: '', departFrom: 1, departTo: END_OF_SPAN,
    depart: `${month}-12`, returnDate: `${month}-15`,
    adults: 1, children: 0, infants: 0, cabin: 'Economy',
    stops: 'any', maxPrice: null, airlines: [], maxDurationHours: null,
    includeGround: true, home: HOME_BY_NAME.Lyon, sort: 'total', currency: 'EUR',
    hoverId: null, selectedId: null, focusPoint: null, fitRequest: null, popover: null,
    mobileView: 'list',
  };
}
