import { UpstreamError } from '../types.ts';
import type { AirportInfo, Fare, FareProvider, InboundQuery, InboundResult, Place } from '../types.ts';
import type { ReferenceData } from './reference-data.ts';

/**
 * Travelpayouts / Aviasales Data API (cached prices, free with a token).
 * Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163
 *
 * Two endpoints answer "every origin to one destination" when origin is omitted:
 *  - v3/prices_for_dates: airline, flight duration, booking link, but no found_at.
 *  - v3/get_latest_prices: found_at and transfers, but no airline or link.
 * Both are called and merged on (origin city, depart date, return date).
 */
export interface TravelpayoutsOptions {
  token: string;
  referenceData: ReferenceData;
  /** Affiliate marker appended to links. Optional. */
  marker?: string;
  /** Aviasales markets to query and merge; "auto" uses the destination's country. */
  markets?: string[] | 'auto';
  currency?: string;
  maxPages?: number;
  pageSize?: number;
  timeoutMs?: number;
  baseUrl?: string;
  linkBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface PricesForDatesRow {
  origin: string; destination: string; origin_airport?: string; destination_airport?: string;
  price: number; airline?: string; flight_number?: string | number;
  departure_at: string; return_at?: string | null;
  transfers?: number; return_transfers?: number;
  duration?: number; duration_to?: number; duration_back?: number;
  link?: string;
}
interface LatestPricesRow {
  origin: string; destination: string; depart_date: string; return_date?: string | null;
  number_of_changes?: number; value: number; found_at?: string; duration?: number;
}
interface ApiEnvelope<T> { success?: boolean; data?: T[]; error?: string | null; currency?: string }

export class TravelpayoutsProvider implements FareProvider {
  readonly name = 'travelpayouts';
  private readonly options: Required<Omit<TravelpayoutsOptions, 'marker'>> & { marker?: string };

  constructor(options: TravelpayoutsOptions) {
    if (!options.token) throw new Error('TravelpayoutsProvider needs a token (TRAVELPAYOUTS_API_TOKEN)');
    this.options = {
      markets: 'auto', currency: 'EUR', maxPages: 2, pageSize: 1000, timeoutMs: 15_000,
      baseUrl: 'https://api.travelpayouts.com', linkBaseUrl: 'https://www.aviasales.com',
      fetchImpl: fetch, ...options,
    };
  }

  async searchInbound(query: InboundQuery, signal?: AbortSignal): Promise<InboundResult> {
    const reference = this.options.referenceData;
    await reference.ensureLoaded();
    const markets = this.marketsFor(query.destination);

    const calls = markets.flatMap((market) => [
      this.fetchPricesForDates(query, market, signal).then((rows) => ({ kind: 'dates' as const, rows })),
      this.fetchLatestPrices(query, market, signal).then((rows) => ({ kind: 'latest' as const, rows })),
    ]);
    const settled = await Promise.allSettled(calls);
    const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failures.length === settled.length) {
      const reason = failures[0]?.reason;
      throw new UpstreamError(`Travelpayouts unavailable: ${reason instanceof Error ? reason.message : reason}`);
    }
    for (const failure of failures) console.warn('[travelpayouts] partial failure:', String(failure.reason));

    const datesRows: PricesForDatesRow[] = [];
    const latestRows: LatestPricesRow[] = [];
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      if (result.value.kind === 'dates') datesRows.push(...result.value.rows);
      else latestRows.push(...result.value.rows);
    }
    const fares = this.mergeRows(query, datesRows, latestRows);

    const airports: Record<string, AirportInfo> = {};
    for (const code of new Set([query.destination, ...fares.map((fare) => fare.origin)])) {
      const info = reference.describe(code);
      if (info) airports[code] = info;
    }
    return { destination: query.destination, currency: this.options.currency, fares, airports };
  }

  async searchPlaces(term: string, limit: number): Promise<Place[]> {
    await this.options.referenceData.ensureLoaded();
    return this.options.referenceData.searchPlaces(term, limit);
  }

  /** Exposed for tests: turns raw rows from both endpoints into contract fares. */
  mergeRows(query: InboundQuery, datesRows: PricesForDatesRow[], latestRows: LatestPricesRow[]): Fare[] {
    const reference = this.options.referenceData;
    const tripKey = (cityCode: string, depart: string, ret: string | null) => `${cityCode}|${depart}|${ret ?? ''}`;

    // Newest sighting per (origin city, dates), for found_at.
    const latestByKey = new Map<string, LatestPricesRow>();
    for (const row of latestRows) {
      const key = tripKey(reference.cityCodeOf(row.origin), row.depart_date, returnDateOf(query, row.return_date));
      const previous = latestByKey.get(key);
      if (!previous || (row.found_at ?? '') > (previous.found_at ?? '')) latestByKey.set(key, row);
    }

    const fares: Fare[] = [];
    const citiesWithDetailedFares = new Set<string>();
    for (const row of datesRows) {
      const departDate = row.departure_at.slice(0, 10);
      const returnDate = returnDateOf(query, row.return_at?.slice(0, 10));
      const origin = row.origin_airport || row.origin;
      const cityCode = reference.cityCodeOf(row.origin);
      citiesWithDetailedFares.add(cityCode);
      const sighting = latestByKey.get(tripKey(cityCode, departDate, returnDate));
      fares.push({
        origin,
        destination: query.destination,
        price: Math.round(row.price),
        transfers: Math.max(row.transfers ?? 0, query.trip === 'round' ? row.return_transfers ?? 0 : 0),
        airlines: row.airline ? [reference.airlineName(row.airline)] : [],
        departure_at: departDate,
        return_at: returnDate,
        duration_minutes: row.duration_to ?? (query.trip === 'oneway' ? row.duration ?? null : null),
        found_at: normalizeTimestamp(sighting?.found_at),
        link: this.withMarker(row.link
          ? this.options.linkBaseUrl + (row.link.startsWith('/') ? '' : '/') + row.link
          : this.searchLink(origin, query.destination, departDate, returnDate)),
      });
    }

    // Sightings from cities the detailed endpoint did not cover.
    for (const row of latestByKey.values()) {
      const cityCode = reference.cityCodeOf(row.origin);
      if (citiesWithDetailedFares.has(cityCode)) continue;
      const returnDate = returnDateOf(query, row.return_date);
      fares.push({
        origin: row.origin,
        destination: query.destination,
        price: Math.round(row.value),
        transfers: row.number_of_changes ?? 0,
        airlines: [],
        departure_at: row.depart_date,
        return_at: returnDate,
        duration_minutes: null,
        found_at: normalizeTimestamp(row.found_at),
        link: this.withMarker(this.searchLink(row.origin, query.destination, row.depart_date, returnDate)),
      });
    }
    return fares;
  }

  private marketsFor(destination: string): string[] {
    if (this.options.markets !== 'auto') return this.options.markets;
    const country = this.options.referenceData.describe(destination)?.country_code;
    return [country ? country.toLowerCase() : 'us'];
  }

  private dateParams(query: InboundQuery): { departureAt: string; returnAt: string | null } {
    if (query.dateMode === 'exact') {
      return { departureAt: query.depart!, returnAt: query.trip === 'round' ? query.return! : null };
    }
    return { departureAt: query.month!, returnAt: query.trip === 'round' ? query.month! : null };
  }

  private async fetchPricesForDates(query: InboundQuery, market: string, signal?: AbortSignal) {
    const { departureAt, returnAt } = this.dateParams(query);
    const params: Record<string, string> = {
      destination: query.destination, departure_at: departureAt,
      one_way: String(query.trip === 'oneway'), direct: 'false', unique: 'false',
      sorting: 'price', currency: this.options.currency.toLowerCase(), market,
      limit: String(this.options.pageSize),
    };
    if (returnAt) params.return_at = returnAt;
    return this.fetchPages<PricesForDatesRow>('/aviasales/v3/prices_for_dates', params, signal);
  }

  private async fetchLatestPrices(query: InboundQuery, market: string, signal?: AbortSignal) {
    const month = query.dateMode === 'exact' ? query.depart!.slice(0, 7) : query.month!;
    const params: Record<string, string> = {
      destination: query.destination, period_type: 'month', beginning_of_period: `${month}-01`,
      one_way: String(query.trip === 'oneway'), group_by: 'dates', sorting: 'price',
      currency: this.options.currency.toLowerCase(), market, trip_class: '0',
      limit: String(this.options.pageSize),
    };
    return this.fetchPages<LatestPricesRow>('/aviasales/v3/get_latest_prices', params, signal);
  }

  private async fetchPages<T>(endpoint: string, params: Record<string, string>, signal?: AbortSignal): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= this.options.maxPages; page++) {
      const url = new URL(endpoint, this.options.baseUrl);
      for (const [key, value] of Object.entries({ ...params, page: String(page) })) url.searchParams.set(key, value);
      const timeout = AbortSignal.timeout(this.options.timeoutMs);
      const response = await this.options.fetchImpl(url, {
        headers: { 'X-Access-Token': this.options.token, 'Accept-Encoding': 'gzip, deflate' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
      if (!response.ok || !body || body.success === false) {
        throw new Error(`${endpoint} HTTP ${response.status}${body?.error ? `: ${body.error}` : ''}`);
      }
      const data = body.data ?? [];
      rows.push(...data);
      if (data.length < this.options.pageSize) break;
    }
    return rows;
  }

  private searchLink(origin: string, destination: string, depart: string, ret: string | null): string {
    const ddmm = (date: string | null) => (date ? date.slice(8, 10) + date.slice(5, 7) : '');
    return `${this.options.linkBaseUrl}/search/${origin}${ddmm(depart)}${destination}${ddmm(ret)}1`;
  }

  private withMarker(link: string): string {
    if (!this.options.marker) return link;
    const url = new URL(link);
    url.searchParams.set('marker', this.options.marker);
    return url.toString();
  }
}

function returnDateOf(query: InboundQuery, value: string | null | undefined): string | null {
  return query.trip === 'round' && value ? value.slice(0, 10) : null;
}

/** Upstream timestamps may lack a zone; they are UTC. */
export function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z';
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
