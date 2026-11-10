import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createService, loadConfig } from './config.ts';
import { parseInboundQuery } from './query.ts';
import type { InboundService } from './service.ts';
import { UpstreamError } from './types.ts';

export interface ServerOptions { corsOrigin: string }

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export function createApp(service: InboundService, options: ServerOptions): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Access-Control-Allow-Origin', options.corsOrigin);
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' });
      response.end();
      return;
    }
    if (request.method !== 'GET') {
      sendJson(response, 405, errorBody('method_not_allowed', 'Only GET is supported'));
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const started = Date.now();
    try {
      switch (url.pathname) {
        case '/api/health':
          sendJson(response, 200, { ok: true, provider: service.providerName });
          return;
        case '/api/inbound': {
          const parsed = parseInboundQuery(url.searchParams);
          if (!parsed.ok) {
            sendJson(response, 400, errorBody('invalid_params', parsed.message));
            return;
          }
          const result = await service.searchInbound(parsed.query);
          sendJson(response, 200, result, { 'Cache-Control': 'public, max-age=300' });
          return;
        }
        case '/api/places': {
          const places = await service.searchPlaces(url.searchParams.get('q') ?? '', 10);
          sendJson(response, 200, places, { 'Cache-Control': 'public, max-age=86400' });
          return;
        }
        default:
          sendJson(response, 404, errorBody('not_found', `No route for ${url.pathname}`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${request.method} ${url.pathname}]`, message);
      if (error instanceof UpstreamError) {
        sendJson(response, 502, errorBody('upstream_unavailable', 'The fare source is not responding. Try again shortly.'));
      } else {
        sendJson(response, 500, errorBody('internal_error', 'Something went wrong on the server.'));
      }
    } finally {
      console.log(`${request.method} ${url.pathname}${url.search} ${response.statusCode} ${Date.now() - started}ms`);
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  const service = createService(config);
  createApp(service, { corsOrigin: config.corsOrigin }).listen(config.port, () => {
    console.log(`Whence back end on http://localhost:${config.port} (provider: ${config.provider})`);
  });
}
