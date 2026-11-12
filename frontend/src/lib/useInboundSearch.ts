import { useCallback, useEffect, useState } from 'react';
import { fareSource, searchAcrossMonths, type InboundQuery, type InboundResponse } from '../api';

/** Longest the UI waits for an answer before showing the error and a retry button. */
export const SEARCH_TIMEOUT_MS = 45_000;

/** How far along a running search is: month requests answered, and when it started. */
export interface SearchProgress {
  done: number;
  total: number;
  startedAt: number;
}

export interface SearchStatus {
  response: InboundResponse | null;
  loading: boolean;
  error: Error | null;
  progress: SearchProgress | null;
  retry(): void;
}

export class SearchTimeoutError extends Error {
  constructor() {
    super(`No answer from the fare service after ${SEARCH_TIMEOUT_MS / 1000} s`);
    this.name = 'SearchTimeoutError';
  }
}

/**
 * Re-runs the search whenever the query changes; stale responses are dropped via
 * AbortController. A search that has not answered within SEARCH_TIMEOUT_MS is
 * abandoned and reported as an error, so the loading state always ends.
 */
export function useInboundSearch(query: InboundQuery | null): SearchStatus {
  const [response, setResponse] = useState<InboundResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = query ? JSON.stringify(query) : '';

  useEffect(() => {
    if (!query) {
      setResponse(null);
      setLoading(false);
      setError(null);
      setProgress(null);
      return;
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, SEARCH_TIMEOUT_MS);
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: 1, startedAt });
    searchAcrossMonths(fareSource, query, controller.signal,
      (done, total) => setProgress({ done, total, startedAt }))
      .then(result => { setResponse(result); setLoading(false); setProgress(null); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        setResponse(null);
        setError(timedOut ? new SearchTimeoutError() : reason instanceof Error ? reason : new Error(String(reason)));
        setLoading(false);
        setProgress(null);
      })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
    // `key` captures every field of `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { response, loading, error, progress, retry };
}
