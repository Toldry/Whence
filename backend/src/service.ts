import { TtlCache } from './cache.ts';
import { fitsTripShape, queryCacheKey } from './query.ts';
import type { Fare, FareProvider, InboundQuery, InboundResponse, InboundResult, Place } from './types.ts';

export interface InboundServiceOptions {
  cache: TtlCache<InboundResult>;
  placesCache?: TtlCache<Place[]>;
  now?: () => Date;
}

/**
 * Provider-independent search logic: caching, trip-shape filtering, and
 * trimming to the fares the client actually shows.
 */
export class InboundService {
  private readonly now: () => Date;
  private readonly provider: FareProvider;
  private readonly options: InboundServiceOptions;
  constructor(provider: FareProvider, options: InboundServiceOptions) {
    this.provider = provider;
    this.options = options;
    this.now = options.now ?? (() => new Date());
  }

  get providerName(): string { return this.provider.name; }

  async searchInbound(query: InboundQuery): Promise<InboundResponse> {
    const hit = await this.options.cache.getOrLoad(queryCacheKey(query), async () => {
      const raw = await this.provider.searchInbound(query);
      return finalizeResult(raw, query, this.now().toISOString().slice(0, 10));
    });
    return {
      ...hit.value,
      meta: {
        provider: this.provider.name, cached: hit.cached, stale: hit.stale,
        generated_at: this.now().toISOString(),
      },
    };
  }

  async searchPlaces(term: string, limit = 10): Promise<Place[]> {
    const normalized = term.trim().toLowerCase();
    if (normalized.length < 2) return [];
    const load = () => this.provider.searchPlaces(normalized, limit);
    if (!this.options.placesCache) return load();
    return (await this.options.placesCache.getOrLoad(`${normalized}|${limit}`, load)).value;
  }
}

/**
 * Keeps fares that fit the query and can be plotted, then trims each origin
 * to its cheapest fare plus its cheapest nonstop (what the client shows).
 */
export function finalizeResult(raw: InboundResult, query: InboundQuery, today: string): InboundResult {
  const fitting = raw.fares.filter((fare) =>
    fare.origin !== raw.destination && raw.airports[fare.origin] !== undefined
    && Number.isFinite(fare.price) && fare.price > 0
    && fitsTripShape(query, fare.departure_at, fare.return_at, today));

  const byOrigin = new Map<string, Fare[]>();
  for (const fare of fitting) {
    const list = byOrigin.get(fare.origin) ?? [];
    list.push(fare);
    byOrigin.set(fare.origin, list);
  }
  const fares: Fare[] = [];
  for (const list of byOrigin.values()) {
    list.sort((a, b) => a.price - b.price || a.transfers - b.transfers);
    const cheapest = list[0]!;
    fares.push(cheapest);
    const nonstop = list.find((fare) => fare.transfers === 0);
    if (nonstop && nonstop !== cheapest) fares.push(nonstop);
  }
  fares.sort((a, b) => a.price - b.price);

  const airports: InboundResult['airports'] = {};
  for (const code of [raw.destination, ...byOrigin.keys()]) {
    const info = raw.airports[code];
    if (info) airports[code] = info;
  }
  return { destination: raw.destination, currency: raw.currency, fares, airports };
}
