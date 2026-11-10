import { createService, loadConfig, referenceData } from './config.ts';
import type { EnvVars } from './config.ts';
import { KvCache } from './kv-cache.ts';
import type { KvNamespaceLike } from './kv-cache.ts';
import { handleRequest } from './routes.ts';
import type { RouteOptions } from './routes.ts';
import type { InboundService } from './service.ts';
import type { InboundResult } from './types.ts';

/** Bindings from wrangler.jsonc (vars, secrets and the KV namespace). */
type WorkerEnv = EnvVars & { FARE_CACHE?: KvNamespaceLike };

// Index the bundled airport data while the isolate starts, which has a far larger
// CPU allowance than a request on the free plan (10 ms).
referenceData();

let app: { service: InboundService; options: RouteOptions } | undefined;

function appFor(env: WorkerEnv) {
  if (app) return app;
  const { FARE_CACHE: kv, ...vars } = env;
  const config = loadConfig(vars);
  const cache = kv
    ? new KvCache<InboundResult>({
      kv, prefix: 'inbound:v1:',
      ttlMs: config.cache.ttlMinutes * 60_000,
      staleMs: config.cache.staleHours * 3_600_000,
    })
    : undefined;
  app = { service: createService(config, undefined, cache), options: { corsOrigins: config.corsOrigins } };
  return app;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const started = Date.now();
    let current: ReturnType<typeof appFor>;
    try {
      current = appFor(env);
    } catch (error) {
      // Usually a missing secret (TRAVELPAYOUTS_API_TOKEN); the message names it.
      console.error('[config]', error instanceof Error ? error.message : String(error));
      return Response.json({ error: { code: 'misconfigured', message: 'The server is not configured yet.' } },
        { status: 503 });
    }
    const response = await handleRequest(request, current.service, current.options);
    const url = new URL(request.url);
    console.log(`${request.method} ${url.pathname}${url.search} ${response.status} ${Date.now() - started}ms`);
    return response;
  },
};
