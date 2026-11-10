import type { FareSource, InboundQuery, InboundResponse, PlaceSuggestion } from './types';

/** Calls GET {baseUrl}/api/inbound as described in the API contract. */
export function createHttpFareSource(baseUrl: string): FareSource {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async searchInbound(query: InboundQuery, signal?: AbortSignal): Promise<InboundResponse> {
      const params = new URLSearchParams({
        destination: query.destination,
        trip: query.trip,
        date_mode: query.dateMode,
      });
      if (query.dateMode === 'flex') {
        params.set('month', query.month);
        params.set('flex_kind', query.flexKind);
        if (query.flexKind === 'custom') params.set('length', String(query.length));
      } else {
        params.set('depart', query.depart);
        if (query.trip === 'round') params.set('return', query.returnDate);
      }
      return getJson<InboundResponse>(`${root}/api/inbound?${params}`, signal);
    },
    searchPlaces(text: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
      return getJson<PlaceSuggestion[]>(`${root}/api/places?${new URLSearchParams({ q: text })}`, signal);
    },
  };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* body was not JSON */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
