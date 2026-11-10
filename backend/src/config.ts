import { TtlCache } from './cache.ts';
import { MockProvider } from './providers/mock.ts';
import { ReferenceData } from './providers/reference-data.ts';
import { TravelpayoutsProvider } from './providers/travelpayouts.ts';
import { InboundService } from './service.ts';
import type { FareProvider, InboundResult, Place } from './types.ts';

export interface AppConfig {
  port: number;
  corsOrigin: string;
  provider: 'mock' | 'travelpayouts';
  travelpayouts: { token: string; marker?: string; markets: string[] | 'auto'; maxPages: number };
  cache: { ttlMinutes: number; staleHours: number; maxEntries: number };
  referenceCacheDir: string;
}

const numberFrom = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
    corsOrigin: env.CORS_ORIGIN || '*',
    provider,
    travelpayouts: {
      token,
      marker: env.TRAVELPAYOUTS_MARKER || undefined,
      markets: markets === 'auto' || markets === '' ? 'auto' : markets.split(',').map((m) => m.trim()).filter(Boolean),
      maxPages: numberFrom(env.TRAVELPAYOUTS_MAX_PAGES, 2),
    },
    cache: {
      ttlMinutes: numberFrom(env.CACHE_TTL_MINUTES, 30),
      staleHours: numberFrom(env.CACHE_STALE_HOURS, 24),
      maxEntries: numberFrom(env.CACHE_MAX_ENTRIES, 500),
    },
    referenceCacheDir: env.REFERENCE_CACHE_DIR || '.cache/reference',
  };
}

export function createProvider(config: AppConfig): FareProvider {
  if (config.provider === 'mock') return new MockProvider();
  return new TravelpayoutsProvider({
    ...config.travelpayouts,
    referenceData: new ReferenceData({ cacheDir: config.referenceCacheDir }),
  });
}

export function createService(config: AppConfig, provider = createProvider(config)): InboundService {
  return new InboundService(provider, {
    cache: new TtlCache<InboundResult>({
      maxEntries: config.cache.maxEntries,
      ttlMs: config.cache.ttlMinutes * 60_000,
      staleMs: config.cache.staleHours * 3_600_000,
    }),
    placesCache: new TtlCache<Place[]>({ maxEntries: 2000, ttlMs: 86_400_000, staleMs: 0 }),
  });
}
