import type { DateMode, FlexKind, InboundQuery, TripType } from './types.ts';

export type ParseResult =
  | { ok: true; query: InboundQuery }
  | { ok: false; message: string };

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IATA_PATTERN = /^[A-Z]{3}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function pickEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T | null {
  if (raw === null || raw === '') return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Validates /api/inbound query parameters (names as in the contract). */
export function parseInboundQuery(params: URLSearchParams): ParseResult {
  const destination = (params.get('destination') ?? '').trim().toUpperCase();
  if (!IATA_PATTERN.test(destination)) {
    return { ok: false, message: 'destination must be a 3-letter IATA airport or city code' };
  }
  const trip = pickEnum<TripType>(params.get('trip'), ['round', 'oneway'], 'round');
  if (!trip) return { ok: false, message: 'trip must be "round" or "oneway"' };
  const dateMode = pickEnum<DateMode>(params.get('date_mode'), ['flex', 'exact'], 'flex');
  if (!dateMode) return { ok: false, message: 'date_mode must be "flex" or "exact"' };

  if (dateMode === 'exact') {
    const depart = params.get('depart') ?? '';
    if (!isValidDate(depart)) return { ok: false, message: 'depart must be a date, YYYY-MM-DD' };
    if (trip === 'oneway') return { ok: true, query: { destination, trip, dateMode, depart } };
    const returnDate = params.get('return') ?? '';
    if (!isValidDate(returnDate)) {
      return { ok: false, message: 'return must be a date, YYYY-MM-DD, for round trips' };
    }
    if (returnDate < depart) return { ok: false, message: 'return must not be before depart' };
    return { ok: true, query: { destination, trip, dateMode, depart, return: returnDate } };
  }

  const month = params.get('month') ?? '';
  if (!MONTH_PATTERN.test(month)) return { ok: false, message: 'month must be YYYY-MM' };
  const flexKind = pickEnum<FlexKind>(params.get('flex_kind'), ['weekend', 'week', 'custom'], 'weekend');
  if (!flexKind) return { ok: false, message: 'flex_kind must be "weekend", "week" or "custom"' };
  const departWindow = parseDepartWindow(params, month);
  if (typeof departWindow === 'string') return { ok: false, message: departWindow };
  if (flexKind !== 'custom') return { ok: true, query: { destination, trip, dateMode, month, flexKind, ...departWindow } };
  const length = Number(params.get('length'));
  if (!Number.isInteger(length) || length < 1 || length > 31) {
    return { ok: false, message: 'length must be a whole number of days, 1 to 31' };
  }
  return { ok: true, query: { destination, trip, dateMode, month, flexKind, length, ...departWindow } };
}

/** Optional depart_from / depart_to, each a date inside `month`; an error message when invalid. */
function parseDepartWindow(
  params: URLSearchParams, month: string,
): { departFrom?: string; departTo?: string } | string {
  const bounds: { departFrom?: string; departTo?: string } = {};
  for (const [name, key] of [['depart_from', 'departFrom'], ['depart_to', 'departTo']] as const) {
    const value = params.get(name);
    if (value === null || value === '') continue;
    if (!isValidDate(value) || !value.startsWith(month + '-')) {
      return `${name} must be a date, YYYY-MM-DD, within month`;
    }
    bounds[key] = value;
  }
  if (bounds.departFrom && bounds.departTo && bounds.departTo < bounds.departFrom) {
    return 'depart_to must not be before depart_from';
  }
  return bounds;
}

/** A stable cache key: the same search always maps to the same string. */
export function queryCacheKey(query: InboundQuery): string {
  return [
    query.destination, query.trip, query.dateMode, query.month ?? '', query.flexKind ?? '',
    query.length ?? '', query.depart ?? '', query.return ?? '',
    query.departFrom ?? '', query.departTo ?? '',
  ].join('|');
}

const DAY_MS = 86_400_000;
const dayOfWeek = (isoDate: string) => new Date(isoDate + 'T00:00:00Z').getUTCDay();
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);

// Trip-shape rules for flexible dates. Cached fares are sparse, so each shape
// accepts a small window rather than one exact pattern.
const WEEKEND_DEPART_DAYS = new Set([4, 5, 6]); // Thu, Fri, Sat
const WEEKEND_RETURN_DAYS = new Set([0, 1]); // Sun, Mon
export const WEEK_LENGTH_RANGE = [6, 8] as const;
export const CUSTOM_LENGTH_TOLERANCE = 1;

/**
 * Does a fare with these dates answer the query? Dates are YYYY-MM-DD.
 * `today` excludes departures already in the past.
 */
export function fitsTripShape(
  query: InboundQuery, departDate: string, returnDate: string | null, today: string,
): boolean {
  if (departDate < today) return false;
  if (query.trip === 'round' && !returnDate) return false;
  if (query.dateMode === 'exact') {
    return departDate === query.depart && (query.trip === 'oneway' || returnDate === query.return);
  }
  if (!departDate.startsWith(query.month + '-')) return false;
  if (query.departFrom && departDate < query.departFrom) return false;
  if (query.departTo && departDate > query.departTo) return false;
  if (query.flexKind === 'weekend' && !WEEKEND_DEPART_DAYS.has(dayOfWeek(departDate))) return false;
  if (query.trip === 'oneway' || !returnDate) return true;

  const stay = daysBetween(departDate, returnDate);
  switch (query.flexKind) {
    case 'weekend':
      return stay >= 1 && stay <= 4 && WEEKEND_RETURN_DAYS.has(dayOfWeek(returnDate));
    case 'week':
      return stay >= WEEK_LENGTH_RANGE[0] && stay <= WEEK_LENGTH_RANGE[1];
    case 'custom':
      return Math.abs(stay - (query.length ?? 0)) <= CUSTOM_LENGTH_TOLERANCE;
    default:
      return true;
  }
}
