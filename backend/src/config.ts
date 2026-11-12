import { TtlCache } from './cache.ts';
import { MockProvider } from './providers/mock.ts';
import referenceJson from './data/reference.json' with { type: 'json' };
import { ReferenceData } from './providers/reference-data.ts';
import type { SlimReference } from './providers/reference-data.ts';
import { TravelpayoutsProvider } from './providers/travelpayouts.ts';
import { InboundService } from './service.ts';
import type { FareCache } from './cache.ts';
import type { FareProvider, InboundResult, Place } from './types.ts';

/** Environment variables as plain strings (process.env in Node, the Worker's env). */
export type EnvVars = Record<string, string | undefined>;

export interface AppConfig {
  port: number;
  /** Browser origins allowed by CORS; ["*"] allows any. */
  corsOrigins: string[];
  provider: 'mock' | 'travelpayouts';
  travelpayouts: {
    token: string; marker?: string; markets: string[] | 'auto'; maxPages: number; searchBudgetMs: number;
  };
  cache: { ttlMinutes: number; staleHours: number; maxEntries: number };
}

const numberFrom = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

export function loadConfig(env: EnvVars): AppConfig {
  const token = env.TRAVELPAYOUTS_API_TOKEN ?? '';
  // Default to the real data source once a token exists.
  const provider = (env.FARE_PROVIDER || (token ? 'travelpayouts' : 'mock')) as AppConfig['provider'];
  if (provider !== 'mock' && provider !== 'travelpayouts') {
    throw new Error(`FARE_PROVIDER must be "mock" or "travelpayouts", got "${provider}"`);
  }
  if (provider === 'travelpayouts' && !token) {
    throw new Error('FARE_PROVIDER=travelpayouts needs TRAVELPAYOUTS_API_TOKEN');
  }
  const markets = (env.TRAVELPAYOUTS_MARKETS ?? 'auto').trim().toLowerCase();
  return {
    port: numberFrom(env.PORT, 8787),
    corsOrigins: (env.CORS_ORIGINS || env.CORS_ORIGIN || '*').split(',').map((o) => o.trim()).filter(Boolean),
    provider,
    travelpayouts: {
      token,
      marker: env.TRAVELPAYOUTS_MARKER || undefined,
      markets: markets === 'auto' || markets === '' ? 'auto' : markets.split(',').map((m) => m.trim()).filter(Boolean),
      maxPages: numberFrom(env.TRAVELPAYOUTS_MAX_PAGES, 2),
      searchBudgetMs: numberFrom(env.SEARCH_BUDGET_MS, 20_000),
    },
    cache: {
      ttlMinutes: numberFrom(env.CACHE_TTL_MINUTES, 30),
      staleHours: numberFrom(env.CACHE_STALE_HOURS, 24),
      maxEntries: numberFrom(env.CACHE_MAX_ENTRIES, 500),
    },
  };
}

let sharedReferenceData: ReferenceData | undefined;
/** The bundled airport and city data, indexed once per process or isolate. */
export function referenceData(): ReferenceData {
  sharedReferenceData ??= new ReferenceData(referenceJson as unknown as SlimReference);
  return sharedReferenceData;
}

export function createProvider(config: AppConfig): FareProvider {
  if (config.provider === 'mock') return new MockProvider();
  return new TravelpayoutsProvider({ ...config.travelpayouts, referenceData: referenceData() });
}

/** The default cache is in memory; the Worker passes a KV-backed one. */
export function createService(
  config: AppConfig,
  provider = createProvider(config),
  cache: FareCache<InboundResult> = new TtlCache<InboundResult>({
    maxEntries: config.cache.maxEntries,
    ttlMs: config.cache.ttlMinutes * 60_000,
    staleMs: config.cache.staleHours * 3_600_000,
  }),
): InboundService {
  return new InboundService(provider, {
    cache,
    placesCache: new TtlCache<Place[]>({ maxEntries: 2000, ttlMs: 86_400_000, staleMs: 0 }),
  });
}
