// Shapes of the public API (see contracts/inbound-api.md) and the provider seam.

export type TripType = 'round' | 'oneway';
export type DateMode = 'flex' | 'exact';
export type FlexKind = 'weekend' | 'week' | 'custom';

export interface InboundQuery {
  destination: string;
  trip: TripType;
  dateMode: DateMode;
  /** YYYY-MM, flex mode only. */
  month?: string;
  flexKind?: FlexKind;
  /** Trip length in days, flex_kind=custom only. */
  length?: number;
  /** YYYY-MM-DD, exact mode only. */
  depart?: string;
  /** YYYY-MM-DD, exact round trips only. */
  return?: string;
}

export interface Fare {
  origin: string;
  destination: string;
  /** 1 adult, economy, in the response currency; round trip if trip=round. */
  price: number;
  transfers: number;
  /** Display names; may be empty when the upstream does not say. */
  airlines: string[];
  departure_at: string;
  return_at: string | null;
  duration_minutes: number | null;
  /** When the price was seen, ISO 8601 UTC; null when the upstream does not say. */
  found_at: string | null;
  link: string;
}

export interface AirportInfo {
  iata: string;
  name: string;
  city: string;
  country: string;
  country_code: string;
  lat: number;
  lon: number;
}

export interface Place extends AirportInfo {
  type: 'airport' | 'city';
}

export interface InboundResult {
  destination: string;
  currency: string;
  fares: Fare[];
  airports: Record<string, AirportInfo>;
}

export interface InboundResponse extends InboundResult {
  meta: { provider: string; cached: boolean; stale: boolean; generated_at: string };
}

/** The swappable data source. Implementations: mock, travelpayouts. */
export interface FareProvider {
  readonly name: string;
  /**
   * Every origin with a cached fare to query.destination that fits the
   * query's dates. Filtering by trip shape may be left to the service.
   */
  searchInbound(query: InboundQuery, signal?: AbortSignal): Promise<InboundResult>;
  searchPlaces(term: string, limit: number): Promise<Place[]>;
}

/** The upstream fare source failed; maps to 502 upstream_unavailable. */
export class UpstreamError extends Error {
  override name = 'UpstreamError';
}
