/**
 * The contract between the front end and any fare source (mock or HTTP).
 * Mirrors docs/inbound-api.md (v0.2).
 * Field names follow the Travelpayouts / Aviasales Data API where they map cleanly.
 */

export type TripType = 'round' | 'oneway';
export type DateMode = 'flex' | 'exact';
export type FlexKind = 'weekend' | 'week' | 'custom';

export interface InboundQuery {
  destination: string;
  trip: TripType;
  dateMode: DateMode;
  /** YYYY-MM, used when dateMode is 'flex'. */
  month: string;
  flexKind: FlexKind;
  /** Trip length in days, used when flexKind is 'custom'. */
  length: number;
  /** YYYY-MM-DD, used when dateMode is 'exact'. */
  depart: string;
  /** YYYY-MM-DD, used when dateMode is 'exact' and trip is 'round'. */
  returnDate: string;
}

export interface Fare {
  /** IATA airport code, or a city code (e.g. LON) when the upstream only knows the city. */
  origin: string;
  destination: string;
  /** For 1 adult in economy, in the response currency. Round trip if trip=round. */
  price: number;
  transfers: number;
  /** Display names. May be empty when the upstream only knows the price. */
  airlines: string[];
  departure_at: string;
  return_at: string | null;
  duration_minutes?: number | null;
  /** ISO 8601 UTC timestamp of when the price was cached; null when unknown. */
  found_at: string | null;
  link: string;
}

export interface AirportInfo {
  iata: string;
  name: string;
  city: string;
  country: string;
  country_code?: string;
  lat: number;
  lon: number;
}

export interface InboundResponse {
  destination: string;
  currency: string;
  fares: Fare[];
  airports: Record<string, AirportInfo>;
  meta?: { provider?: string; cached?: boolean; stale?: boolean; generated_at?: string };
}

/** A destination suggestion from GET /api/places. */
export interface PlaceSuggestion {
  iata: string;
  name: string;
  city: string;
  country: string;
  country_code?: string;
  lat: number;
  lon: number;
  type?: string;
}

export interface FareSource {
  searchInbound(query: InboundQuery, signal?: AbortSignal): Promise<InboundResponse>;
  searchPlaces(text: string, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
}
