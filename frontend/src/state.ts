import type { DateMode, FlexKind, TripType } from './api/types';
import type { Destination } from './data/places';
import { DESTINATION_BY_IATA } from './data/places';
import type { OriginScope, SortKey, StopsFilter } from './lib/results';
import type { FitRequest, FocusPoint } from './components/InboundMap';

export type PopoverKey =
  | 'currency' | 'trip' | 'pax' | 'cabin' | 'from' | 'to' | 'dates'
  | 'stops' | 'price' | 'airlines' | 'duration' | 'home' | 'sort' | 'groundInfo';

export interface FromState {
  type: OriginScope['type'];
  region: string;
  country: string;
  city: string;
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
  home: string;
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

export function scopeFromState(from: FromState): OriginScope {
  switch (from.type) {
    case 'region': return { type: 'region', region: from.region };
    case 'country': return { type: 'country', country: from.country };
    case 'near': return { type: 'near', city: from.city, radiusKm: from.radiusKm };
    default: return { type: 'anywhere' };
  }
}

export function initialState(): AppState {
  const months = upcomingMonths();
  const month = months[4];
  return {
    destination: DESTINATION_BY_IATA.LIS,
    from: { type: 'anywhere', region: 'western', country: 'Spain', city: 'Paris', radiusKm: 600 },
    trip: 'round', dateMode: 'flex', flexKind: 'weekend', month, length: 5,
    depart: `${month}-12`, returnDate: `${month}-15`,
    adults: 1, children: 0, infants: 0, cabin: 'Economy',
    stops: 'any', maxPrice: null, airlines: [], maxDurationHours: null,
    includeGround: true, home: 'Lyon', sort: 'total', currency: 'EUR',
    hoverId: null, selectedId: null, focusPoint: null, fitRequest: null, popover: null,
    mobileView: 'list',
  };
}
