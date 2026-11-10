import { useCallback, useEffect, useState } from 'react';
import { fareSource, type InboundQuery, type InboundResponse } from '../api';

export interface SearchStatus {
  response: InboundResponse | null;
  loading: boolean;
  error: Error | null;
  retry(): void;
}

/** Re-runs the search whenever the query changes; stale responses are dropped via AbortController. */
export function useInboundSearch(query: InboundQuery | null): SearchStatus {
  const [response, setResponse] = useState<InboundResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = query ? JSON.stringify(query) : '';

  useEffect(() => {
    if (!query) {
      setResponse(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fareSource.searchInbound(query, controller.signal)
      .then(result => { setResponse(result); setLoading(false); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setResponse(null);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        setLoading(false);
      });
    return () => controller.abort();
    // `key` captures every field of `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { response, loading, error, retry };
}
