import { parseInboundQuery } from './query.ts';
import type { InboundService } from './service.ts';
import { UpstreamError } from './types.ts';

export interface RouteOptions {
  /** Origins allowed to call the API from a browser; "*" allows any. */
  corsOrigins: string[];
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

function corsHeaders(request: Request, allowed: string[]): Record<string, string> {
  if (allowed.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/**
 * The API as a web-standard handler (Request in, Response out), shared by the
 * Node server (server.ts) and the Cloudflare Worker (worker.ts).
 */
export async function handleRequest(request: Request, service: InboundService, options: RouteOptions): Promise<Response> {
  const cors = corsHeaders(request, options.corsOrigins);
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...headers },
    });

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
    });
  }
  if (request.method !== 'GET') return json(405, errorBody('method_not_allowed', 'Only GET is supported'));

  const url = new URL(request.url);
  try {
    switch (url.pathname) {
      case '/api/health':
        return json(200, { ok: true, provider: service.providerName });
      case '/api/inbound': {
        const parsed = parseInboundQuery(url.searchParams);
        if (!parsed.ok) return json(400, errorBody('invalid_params', parsed.message));
        const result = await service.searchInbound(parsed.query);
        return json(200, result, { 'Cache-Control': 'public, max-age=300' });
      }
      case '/api/places': {
        const places = await service.searchPlaces(url.searchParams.get('q') ?? '', 10);
        return json(200, places, { 'Cache-Control': 'public, max-age=86400' });
      }
      default:
        return json(404, errorBody('not_found', `No route for ${url.pathname}`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${request.method} ${url.pathname}]`, message);
    if (error instanceof UpstreamError) {
      return json(502, errorBody('upstream_unavailable', 'The fare source is not responding. Try again shortly.'));
    }
    return json(500, errorBody('internal_error', 'Something went wrong on the server.'));
  }
}
