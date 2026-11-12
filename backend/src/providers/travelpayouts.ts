import { UpstreamError } from '../types.ts';
import type { AirportInfo, Fare, FareProvider, InboundQuery, InboundResult, Place } from '../types.ts';
import type { ReferenceData } from './reference-data.ts';
import { pairSelfTransfers, toLeg, type PairedTrip } from './self-transfer.ts';

/**
 * Travelpayouts / Aviasales Data API (cached prices, free with a token).
 * Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163
 *
 * Two endpoints answer "every origin to one destination" when origin is omitted:
 *  - v3/prices_for_dates: airline, flight duration, booking link, but no found_at
 *    (the link's search_date gives the day it was seen).
 *  - v3/get_latest_prices: found_at and transfers, but no airline or link.
 * Both are called and merged on (origin city, depart date, return date).
 *
 * Each endpoint is called in two groupings, because with origin omitted the
 * upstream groups rows in a way that hides most origins (measured live, Nov 2026):
 *  - per day (unique=false / group_by=dates): the cheapest fares per departure
 *    day across all origins. One-way searches get about one row per day, so only
 *    ~10 origins (LIS, Feb 2027: 10 origins).
 *  - per origin (unique=true / group_by=directions): the cheapest fare of the
 *    month for every origin (LIS, Feb 2027: 119 origins one-way, 88 round trip).
 * The union keeps several dates for busy origins and still reaches every origin.
 *
 * The per-origin grouping keeps only each origin's cheapest fare, which is often
 * one with stops, so a pricier nonstop on the same route never comes back (MAD-GUA,
 * Nov 2026: per-origin gave a $606 one-stop and hid an $1,097 Iberia nonstop).
 * prices_for_dates is therefore also called with direct=true, in both groupings,
 * so the nonstop filter has every cached nonstop to work with.
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
  /**
   * One-way searches also join cached nonstops into a hub with the hub's nonstops
   * to the destination (separate tickets). 0 turns this off.
   */
  selfTransferHubs?: number;
  /** Connection window at the hub for self-transfers, in minutes. */
  minConnectionMinutes?: number;
  maxConnectionMinutes?: number;
  /**
   * Time budget for one search, across both waves of calls. The fare calls get all of
   * it; the self-transfer calls run only while at least MIN_SELF_TRANSFER_MS of it is
   * left, and are cut off at the deadline (a hub cut off is skipped, like a failed one).
   */
  searchBudgetMs?: number;
}

/** Hub calls are not started with less time than this left in the search budget. */
const MIN_SELF_TRANSFER_MS = 2_000;

/** Hubs this close to the destination add little: few routes feed them. */
const MIN_HUB_DISTANCE_KM = 300;

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
      // Wrapped: Workers throw "Illegal invocation" when fetch is called as a method.
      fetchImpl: (input, init) => fetch(input, init),
      selfTransferHubs: 10, minConnectionMinutes: 120, maxConnectionMinutes: 24 * 60,
      searchBudgetMs: 20_000, ...options,
    };
  }

  async searchInbound(query: InboundQuery, signal?: AbortSignal): Promise<InboundResult> {
    const reference = this.options.referenceData;
    await reference.ensureLoaded();
    const markets = this.marketsFor(query.destination);
    // Without a deadline, two slow waves of paged calls could keep the client waiting a minute.
    const deadline = Date.now() + this.options.searchBudgetMs;
    const budget = AbortSignal.timeout(this.options.searchBudgetMs);
    const searchSignal = signal ? AbortSignal.any([signal, budget]) : budget;

    const calls = markets.flatMap((market) => [false, true].flatMap((perOrigin) => [
      ...[false, true].map((directOnly) =>
        this.fetchPricesForDates(query, market, perOrigin, directOnly, searchSignal)
          .then((rows) => ({ kind: 'dates' as const, rows }))),
      this.fetchLatestPrices(query, market, perOrigin, searchSignal).then((rows) => ({ kind: 'latest' as const, rows })),
    ]));
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
    const timeLeft = deadline - Date.now();
    if (query.trip === 'oneway' && this.options.selfTransferHubs > 0 && timeLeft >= MIN_SELF_TRANSFER_MS) {
      fares.push(...await this.selfTransferFares(query, markets[0]!, datesRows, fares, searchSignal));
    } else if (query.trip === 'oneway' && this.options.selfTransferHubs > 0) {
      console.warn(`[travelpayouts] skipped self-transfers: ${Math.max(0, timeLeft)} ms of the search budget left`);
    }

    const airports: Record<string, AirportInfo> = {};
    const codes = fares.flatMap((fare) => [fare.origin, ...(fare.self_transfer ? [fare.self_transfer.via] : [])]);
    for (const code of new Set([query.destination, ...codes])) {
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
    // get_latest_prices returns full timestamps (e.g. 2027-03-07T07:15:00+01:00)
    // despite the docs saying dates, so keys and fares use the date part only.
    const latestByKey = new Map<string, LatestPricesRow>();
    for (const row of latestRows) {
      const key = tripKey(reference.cityCodeOf(row.origin), datePart(row.depart_date), returnDateOf(query, row.return_date));
      const previous = latestByKey.get(key);
      if (!previous || (row.found_at ?? '') > (previous.found_at ?? '')) latestByKey.set(key, row);
    }

    const fares: Fare[] = [];
    const citiesWithDetailedFares = new Set<string>();
    const seenDetailed = new Set<string>();
    for (const row of datesRows) {
      const departDate = datePart(row.departure_at);
      const returnDate = returnDateOf(query, row.return_at);
      const origin = row.origin_airport || row.origin;
      // The per-day and per-origin calls overlap; keep each fare once.
      const fareKey = `${origin}|${departDate}|${returnDate ?? ''}|${row.price}|${row.airline ?? ''}`;
      if (seenDetailed.has(fareKey)) continue;
      seenDetailed.add(fareKey);
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
        found_at: normalizeTimestamp(sighting?.found_at) ?? searchDateOf(row.link),
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
      const departDate = datePart(row.depart_date);
      fares.push({
        origin: row.origin,
        destination: query.destination,
        price: Math.round(row.value),
        transfers: row.number_of_changes ?? 0,
        airlines: [],
        departure_at: departDate,
        return_at: returnDate,
        duration_minutes: null,
        found_at: normalizeTimestamp(row.found_at),
        link: this.withMarker(this.searchLink(row.origin, query.destination, departDate, returnDate)),
      });
    }
    return fares;
  }

  /**
   * Separate-ticket trips through the destination's farthest nonstop gateways, for
   * origins that have no cached fare with one stop or fewer. A failed hub is skipped.
   */
  private async selfTransferFares(
    query: InboundQuery, market: string, datesRows: PricesForDatesRow[], fares: Fare[], signal?: AbortSignal,
  ): Promise<Fare[]> {
    const reference = this.options.referenceData;
    const destination = reference.describe(query.destination);
    if (!destination) return [];
    const hubs = [...new Set(datesRows
      .filter((row) => (row.transfers ?? 0) === 0)
      .map((row) => row.origin_airport || row.origin))]
      .map((code) => ({ code, info: reference.describe(code) }))
      .filter((hub) => hub.info && distanceKm(hub.info, destination) >= MIN_HUB_DISTANCE_KM)
      .sort((a, b) => distanceKm(b.info!, destination) - distanceKm(a.info!, destination))
      .slice(0, this.options.selfTransferHubs);
    if (!hubs.length) return [];

    const { departureAt } = this.dateParams(query);
    const month = departureAt.slice(0, 7);
    const settled = await Promise.allSettled(hubs.flatMap(({ code }) => [
      // Every hub's cheapest nonstop per origin into it.
      this.fetchPages<PricesForDatesRow>('/aviasales/v3/prices_for_dates', {
        destination: code, departure_at: departureAt, one_way: 'true', direct: 'true', unique: 'true',
        sorting: 'price', currency: this.options.currency.toLowerCase(), market,
        limit: String(this.options.pageSize),
      }, signal),
      // Every cached nonstop date out of the hub; the month, so next-day connections count.
      this.fetchPages<PricesForDatesRow>('/aviasales/v3/prices_for_dates', {
        origin: code, destination: query.destination, departure_at: month, one_way: 'true', direct: 'true',
        sorting: 'price', currency: this.options.currency.toLowerCase(), market,
        limit: String(this.options.pageSize),
      }, signal),
    ]));
    const feeders: PricesForDatesRow[] = [];
    const onward: PricesForDatesRow[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn('[travelpayouts] self-transfer hub failed:', String(result.reason));
        return;
      }
      (index % 2 === 0 ? feeders : onward).push(...result.value);
    });

    // Origins that already have a fare an airline sells with one stop or fewer.
    const covered = new Set(fares.filter((fare) => fare.transfers <= 1)
      .flatMap((fare) => [fare.origin, reference.cityCodeOf(fare.origin)]));
    const destinationCity = reference.cityCodeOf(query.destination);
    return pairSelfTransfers(feeders, onward, this.options)
      .filter((trip) => !covered.has(trip.origin) && !covered.has(reference.cityCodeOf(trip.origin))
        && reference.cityCodeOf(trip.origin) !== destinationCity)
      .map((trip) => this.selfTransferFare(query, trip));
  }

  private selfTransferFare(query: InboundQuery, trip: PairedTrip): Fare {
    const reference = this.options.referenceData;
    const airlineName = (code: string) => reference.airlineName(code);
    const legLink = (row: PricesForDatesRow) => this.withMarker(row.link
      ? this.options.linkBaseUrl + (row.link.startsWith('/') ? '' : '/') + row.link
      : this.searchLink(row.origin_airport || row.origin, row.destination_airport || row.destination,
        datePart(row.departure_at), null));
    const first = toLeg(trip.first, airlineName, legLink(trip.first));
    const second = toLeg(trip.second, airlineName, legLink(trip.second));
    const seen = [searchDateOf(trip.first.link), searchDateOf(trip.second.link)];
    return {
      origin: trip.origin,
      destination: query.destination,
      price: Math.round(trip.price),
      transfers: 1,
      airlines: [...new Set([...first.airlines, ...second.airlines])],
      departure_at: trip.departDate,
      return_at: null,
      duration_minutes: trip.durationMinutes,
      // The older sighting: the pair is only as fresh as its stalest leg.
      found_at: seen.includes(null) ? null : seen.sort()[0]!,
      link: this.withMarker(this.searchLink(trip.origin, query.destination, trip.departDate, null)),
      self_transfer: { via: trip.via, layover_minutes: trip.layoverMinutes, legs: [first, second] },
    };
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
    // Flexible round trips leave the return open, so a trip that starts late in the
    // month and comes back in the next one is still found (the service checks the stay).
    return { departureAt: query.month!, returnAt: null };
  }

  private async fetchPricesForDates(
    query: InboundQuery, market: string, perOrigin: boolean, directOnly: boolean, signal?: AbortSignal,
  ) {
    const { departureAt, returnAt } = this.dateParams(query);
    const params: Record<string, string> = {
      destination: query.destination, departure_at: departureAt,
      one_way: String(query.trip === 'oneway'), direct: String(directOnly), unique: String(perOrigin),
      sorting: 'price', currency: this.options.currency.toLowerCase(), market,
      limit: String(this.options.pageSize),
    };
    if (returnAt) params.return_at = returnAt;
    return this.fetchPages<PricesForDatesRow>('/aviasales/v3/prices_for_dates', params, signal);
  }

  private async fetchLatestPrices(query: InboundQuery, market: string, perOrigin: boolean, signal?: AbortSignal) {
    const month = query.dateMode === 'exact' ? query.depart!.slice(0, 7) : query.month!;
    const params: Record<string, string> = {
      destination: query.destination, period_type: 'month', beginning_of_period: `${month}-01`,
      one_way: String(query.trip === 'oneway'), group_by: perOrigin ? 'directions' : 'dates', sorting: 'price',
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
      let body: ApiEnvelope<T> | null;
      try {
        const timeout = AbortSignal.timeout(this.options.timeoutMs);
        const response = await this.options.fetchImpl(url, {
          headers: { 'X-Access-Token': this.options.token, 'Accept-Encoding': 'gzip, deflate' },
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
        if (!response.ok || !body || body.success === false) {
          throw new Error(`${endpoint} HTTP ${response.status}${body?.error ? `: ${body.error}` : ''}`);
        }
      } catch (error) {
        // A later page that fails or runs out of time still leaves the earlier pages' rows.
        if (page === 1) throw error;
        console.warn(`[travelpayouts] ${endpoint} page ${page} failed, keeping ${rows.length} rows:`, String(error));
        break;
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

/** Great-circle distance, for ranking hubs. */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** YYYY-MM-DD from an upstream date or timestamp (the local date as sent). */
function datePart(value: string): string {
  return value.slice(0, 10);
}

function returnDateOf(query: InboundQuery, value: string | null | undefined): string | null {
  return query.trip === 'round' && value ? datePart(value) : null;
}

/**
 * prices_for_dates has no found_at, but its link carries search_date=DDMMYYYY.
 * Measured live, that is always the UTC date of get_latest_prices' found_at for the
 * same fare. Returned as the start of that day, so the age shown errs on the old side.
 */
export function searchDateOf(link: string | undefined): string | null {
  const match = /[?&]search_date=(\d{2})(\d{2})(\d{4})(?:&|$)/.exec(link ?? '');
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Upstream timestamps may lack a zone; they are UTC. */
export function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z';
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
