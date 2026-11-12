import type { FareSource, InboundQuery, InboundResponse } from './types';

function lastDayOf(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
}

/**
 * One single-month query per month a flexible search covers, each carrying its share
 * of the departure window. Exact-date and single-month queries pass through.
 */
export function monthQueries(query: InboundQuery): InboundQuery[] {
  const { monthTo, ...single } = query;
  if (query.dateMode !== 'flex' || !monthTo || monthTo <= query.month) return [single];
  const parts: InboundQuery[] = [];
  for (let month = query.month, guard = 0; month <= monthTo && guard < 12; month = nextMonth(month), guard++) {
    const first = `${month}-01`;
    const last = lastDayOf(month);
    if ((query.departFrom && query.departFrom > last) || (query.departTo && query.departTo < first)) continue;
    const part: InboundQuery = { ...single, month };
    delete part.departFrom;
    delete part.departTo;
    if (query.departFrom && query.departFrom > first) part.departFrom = query.departFrom;
    if (query.departTo && query.departTo < last) part.departTo = query.departTo;
    parts.push(part);
  }
  return parts.length ? parts : [single];
}

/** Joins per-month responses: every fare, every airport, stale if any part was. */
export function mergeResponses(responses: InboundResponse[]): InboundResponse {
  const [first] = responses;
  return {
    ...first,
    fares: responses.flatMap(response => response.fares),
    airports: Object.assign({}, ...responses.map(response => response.airports)),
    meta: first.meta && {
      ...first.meta,
      cached: responses.every(response => response.meta?.cached),
      stale: responses.some(response => response.meta?.stale),
    },
  };
}

/**
 * Searches a query that may span several months, one request per month, in parallel.
 * `onProgress` hears how many of the month requests have answered so far.
 */
export async function searchAcrossMonths(
  source: FareSource, query: InboundQuery, signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<InboundResponse> {
  const parts = monthQueries(query);
  let done = 0;
  onProgress?.(0, parts.length);
  const responses = await Promise.all(parts.map(part => source.searchInbound(part, signal).then(response => {
    if (!signal?.aborted) onProgress?.(++done, parts.length);
    return response;
  })));
  return responses.length === 1 ? responses[0] : mergeResponses(responses);
}
