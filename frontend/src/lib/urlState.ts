/**
 * Keeps the user's search, filters and sort in the page's query string, so a link
 * reproduces the same view and a reload keeps it.
 *
 * The mapping is driven by the shape of AppState rather than a hand-kept list, so a new
 * primitive field in AppState is synced automatically. Only values that differ from the
 * defaults are written, except the destination and the active dates, which are always
 * written because their defaults move with today's date.
 */
import type { AppState } from '../state';
import { upcomingMonths } from '../state';
import { DESTINATION_BY_IATA, HOME_BY_NAME, REGIONS, type Destination } from '../data/places';
import { CURRENCY_RATES } from './format';
import { SORTERS } from './results';

/** UI-only state that a shared link should not carry. */
const TRANSIENT_KEYS = new Set<keyof AppState>([
  'hoverId', 'selectedId', 'focusPoint', 'fitRequest', 'popover',
]);

/** Param names for AppState keys; keys not listed use their own name. */
const PARAM_NAME: Partial<Record<keyof AppState, string>> = {
  destination: 'to',
  returnDate: 'return',
  maxPrice: 'maxprice',
  maxDurationHours: 'maxhours',
  includeGround: 'ground',
  mobileView: 'view',
};

/** Allowed values for fields whose type alone is not enough to reject a bad link. */
const ALLOWED: Partial<Record<string, (value: string) => boolean>> = {
  trip: v => v === 'round' || v === 'oneway',
  dateMode: v => v === 'flex' || v === 'exact',
  flexKind: v => v === 'weekend' || v === 'week' || v === 'custom',
  month: v => upcomingMonths().includes(v),
  depart: isIsoDate,
  returnDate: isIsoDate,
  stops: v => v === 'any' || v === '0' || v === '1',
  sort: v => v in SORTERS,
  currency: v => v in CURRENCY_RATES,
  home: v => v in HOME_BY_NAME,
  mobileView: v => v === 'list' || v === 'map',
  'from.type': v => ['anywhere', 'region', 'country', 'near'].includes(v),
  'from.region': v => v in REGIONS,
};

const DESTINATION_EXTRA = ['city', 'country', 'airport', 'lat', 'lon'] as const;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function paramName(key: keyof AppState): string {
  return PARAM_NAME[key] ?? key;
}

/** Nested object fields are flattened to e.g. fromType, fromRadiusKm. */
function nestedName(parent: string, child: string): string {
  return parent + child[0].toUpperCase() + child.slice(1);
}

function encodeScalar(value: unknown): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

/** Parses a param against the type of its default; undefined means "ignore it". */
function decodeScalar(raw: string, fallback: unknown, allowedKey: string): unknown {
  const allowed = ALLOWED[allowedKey];
  if (allowed && raw !== '' && !allowed(raw)) return undefined;
  if (fallback === null || typeof fallback === 'number') {
    if (raw === '') return fallback === null ? null : undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof fallback === 'boolean') {
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return undefined;
  }
  if (typeof fallback === 'string') return raw === '' && allowed ? undefined : raw;
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Fields whose default depends on today, so they are always written while in use. */
function alwaysWritten(state: AppState): Set<keyof AppState> {
  const keys = new Set<keyof AppState>(['destination']);
  if (state.dateMode === 'flex') keys.add('month');
  else {
    keys.add('depart');
    if (state.trip === 'round') keys.add('returnDate');
  }
  return keys;
}

export function stateToParams(state: AppState, defaults: AppState): URLSearchParams {
  const params = new URLSearchParams();
  const always = alwaysWritten(state);
  for (const key of Object.keys(state) as (keyof AppState)[]) {
    if (TRANSIENT_KEYS.has(key)) continue;
    const value = state[key];
    const fallback = defaults[key];
    if (!always.has(key) && sameValue(value, fallback)) continue;
    const name = paramName(key);

    if (key === 'destination') {
      const destination = value as Destination | null;
      params.set(name, destination?.iata ?? '');
      // A destination picked from search isn't in the static list, so carry its details.
      if (destination && !sameValue(DESTINATION_BY_IATA[destination.iata], destination)) {
        for (const field of DESTINATION_EXTRA) params.set(nestedName(name, field), String(destination[field]));
      }
    } else if (Array.isArray(value)) {
      for (const item of value) params.append(name, String(item));
      if (!value.length) params.set(name, '');
    } else if (isPlainObject(value)) {
      const fallbackObject: Record<string, unknown> = isPlainObject(fallback) ? fallback : {};
      for (const [child, childValue] of Object.entries(value)) {
        if (sameValue(childValue, fallbackObject[child])) continue;
        params.set(nestedName(name, child), encodeScalar(childValue));
      }
    } else {
      params.set(name, encodeScalar(value));
    }
  }
  return params;
}

function destinationFromParams(params: URLSearchParams, name: string): Destination | null | undefined {
  const iata = params.get(name)?.trim().toUpperCase();
  if (iata === undefined) return undefined;
  if (iata === '') return null;
  if (!/^[A-Z0-9]{3}$/.test(iata)) return undefined;
  const city = params.get(nestedName(name, 'city'));
  const lat = Number(params.get(nestedName(name, 'lat')));
  const lon = Number(params.get(nestedName(name, 'lon')));
  if (city && Number.isFinite(lat) && Number.isFinite(lon) && params.has(nestedName(name, 'lat'))) {
    return {
      iata, city, lat, lon,
      country: params.get(nestedName(name, 'country')) ?? '',
      airport: params.get(nestedName(name, 'airport')) ?? city,
    };
  }
  return DESTINATION_BY_IATA[iata];
}

/** Returns the defaults with every valid param from the URL applied. Bad params are skipped. */
export function stateFromParams(params: URLSearchParams, defaults: AppState): AppState {
  const next: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof AppState)[]) {
    if (TRANSIENT_KEYS.has(key)) continue;
    const name = paramName(key);
    const fallback: unknown = defaults[key];

    if (key === 'destination') {
      const destination = destinationFromParams(params, name);
      if (destination !== undefined) next[key] = destination;
    } else if (Array.isArray(fallback)) {
      if (params.has(name)) next[key] = params.getAll(name).filter(v => v !== '');
    } else if (isPlainObject(fallback)) {
      const merged: Record<string, unknown> = { ...fallback };
      for (const [child, childFallback] of Object.entries(fallback)) {
        const raw = params.get(nestedName(name, child));
        if (raw === null) continue;
        const decoded = decodeScalar(raw, childFallback, `${key}.${child}`);
        if (decoded !== undefined) merged[child] = decoded;
      }
      next[key] = merged;
    } else {
      const raw = params.get(name);
      if (raw === null) continue;
      const decoded = decodeScalar(raw, fallback, key);
      if (decoded !== undefined) next[key] = decoded;
    }
  }
  return next as unknown as AppState;
}

/** The current page URL with the state's query string, keeping path and hash. */
export function urlForState(state: AppState, defaults: AppState, location: Location): string {
  const query = stateToParams(state, defaults).toString();
  return location.pathname + (query ? `?${query}` : '') + location.hash;
}
