import { useEffect, useState } from 'react';
import { SEARCH_TIMEOUT_MS, type SearchProgress as Progress } from '../lib/useInboundSearch';
import { Icon } from './ui';

/** Seconds since `startedAt`, re-rendering a few times a second. */
function useElapsedMs(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  return Math.max(0, now - startedAt);
}

/** How quickly the bar creeps toward each unanswered month's share, in ms. */
const EASE_MS = 6_000;
/** The creeping part never fills more than this much of an unanswered month's share. */
const EASE_CAP = 0.9;

/**
 * Fraction of the bar to fill. Answered months count in full; the months still out
 * share an eased fill that slows down as it nears its cap, so the bar keeps moving
 * without claiming to be done. It only ever grows while one search runs.
 */
export function progressFraction(done: number, total: number, elapsedMs: number): number {
  if (total <= 0) return 0;
  const easing = EASE_CAP * (1 - Math.exp(-elapsedMs / EASE_MS));
  return Math.min(1, (done + (total - done) * easing) / total);
}

/** What the search is most likely doing, judged by how long it has run. */
export function stageText(elapsedMs: number, oneWay: boolean): string {
  const seconds = elapsedMs / 1000;
  if (seconds < 4) return 'Checking cached fares from every airport…';
  if (seconds < 12) return oneWay ? 'Also looking for connections through hubs…' : 'Collecting fares for every departure day…';
  if (seconds < 25) return 'Still searching. A first search for a route can take up to 30 s.';
  return `The fare service is slow right now. We’ll stop waiting at ${SEARCH_TIMEOUT_MS / 1000} s.`;
}

function countsText(progress: Progress, elapsedMs: number): string {
  const months = progress.total > 1 ? `${progress.done} of ${progress.total} months done · ` : '';
  return `${months}${Math.floor(elapsedMs / 1000)} s`;
}

function Bar({ fraction, label }: { fraction: number; label: string }) {
  return (
    <div className="search-progress-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className="search-progress-fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

/** The loading line under the results heading: stage, counts and a progress bar. */
export function SearchProgressNote({ progress, oneWay }: { progress: Progress; oneWay: boolean }) {
  const elapsedMs = useElapsedMs(progress.startedAt);
  return (
    <div className="search-progress" aria-live="polite">
      <div className="search-progress-line">
        <Icon name="history" size={16} />
        <span className="search-progress-stage">{stageText(elapsedMs, oneWay)}</span>
        <span className="search-progress-counts">{countsText(progress, elapsedMs)}</span>
      </div>
      <Bar fraction={progressFraction(progress.done, progress.total, elapsedMs)} label="Search progress" />
    </div>
  );
}

/** The compact version for the map's notice pill. */
export function SearchProgressPill({ progress }: { progress: Progress }) {
  const elapsedMs = useElapsedMs(progress.startedAt);
  return (
    <div className="map-notice has-progress">
      <div className="map-notice-row">
        <Icon name="history" className="muted" />
        Loading cached prices…
        <span className="search-progress-counts">{countsText(progress, elapsedMs)}</span>
      </div>
      <Bar fraction={progressFraction(progress.done, progress.total, elapsedMs)} label="Search progress" />
    </div>
  );
}
