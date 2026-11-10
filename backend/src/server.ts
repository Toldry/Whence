import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createService, loadConfig } from './config.ts';
import { handleRequest } from './routes.ts';
import type { RouteOptions } from './routes.ts';
import type { InboundService } from './service.ts';

/** Node adapter: turns each request into a web Request for the shared handler. */
export function createApp(service: InboundService, options: RouteOptions): Server {
  return createServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const started = Date.now();
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    }
    const request = new Request(new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`), {
      method: incoming.method, headers,
    });
    const response = await handleRequest(request, service, options);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${incoming.method} ${incoming.url} ${response.status} ${Date.now() - started}ms`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig(process.env);
  const service = createService(config);
  createApp(service, { corsOrigins: config.corsOrigins }).listen(config.port, () => {
    console.log(`Whence back end on http://localhost:${config.port} (provider: ${config.provider})`);
  });
}
