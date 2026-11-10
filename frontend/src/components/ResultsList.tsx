import { useEffect, useRef } from 'react';
import { formatAge, formatDay, formatDuration, formatMoney } from '../lib/format';
import { STALE_ROW_HOURS, type OriginRow, type SortKey } from '../lib/results';
import type { Store } from '../state';
import { TIERS } from '../theme';
import { Dropdown, Icon, OptionList } from './ui';

export const GROUND_MODE = {
  transfer: { label: 'transfer', icon: 'directions_bus', verb: 'airport transfer' },
  bus: { label: 'bus', icon: 'directions_bus', verb: 'bus' },
  train: { label: 'train', icon: 'train', verb: 'train' },
  flight: { label: 'flight', icon: 'flight', verb: 'flight' },
} as const;

export interface EmptySuggestion { label: string; note: string; pick(): void }
export type ListStatus =
  | { kind: 'no-destination' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty'; title: string; body: string; suggestions: EmptySuggestion[] }
  | { kind: 'rows' };

export const SORT_LABELS: Record<SortKey, [string, string]> = {
  total: ['Total cost', 'Total trip cost'],
  price: ['Price', 'Flight price'],
  duration: ['Duration', 'Flight duration'],
  date: ['Date', 'Departure date, earliest first'],
  fresh: ['Freshest', 'Most recently found'],
};

export function ResultsList({ store, rows, status, sortKey, ageNote, showStaleBanner, onRetry, destinationPicks, priceCaption }: {
  store: Store;
  rows: OriginRow[];
  status: ListStatus;
  sortKey: SortKey;
  ageNote: string;
  showStaleBanner: boolean;
  onRetry(): void;
  destinationPicks: { label: string; pick(): void }[];
  priceCaption: string;
}) {
  const { state: s, set, togglePopover } = store;
  const listRef = useRef<HTMLDivElement>(null);
  const money = (v: number) => formatMoney(v, s.currency);
  const hasHome = s.includeGround;
  const destination = s.destination;

  // When a marker is picked on the map, bring its row into view.
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (s.selectedId === lastSelected.current) return;
    lastSelected.current = s.selectedId;
    const box = listRef.current;
    const el = s.selectedId && box?.querySelector<HTMLElement>(`[data-id="${s.selectedId}"]`);
    if (box && el && (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight)) {
      box.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
    }
  }, [s.selectedId]);

  const select = (id: string) => set(st => ({
    selectedId: id,
    fitRequest: { key: (st.fitRequest?.key ?? 0) + 1, id },
  }));

  return (
    <aside className="sidebar">
      {destination && (
        <div className="list-head">
          <div className="list-head-top">
            <h1 className="list-title">
              {status.kind === 'loading' ? `Finding flights to ${destination.city}…`
                : status.kind === 'error' ? `Flights to ${destination.city}`
                : `${rows.length} ${rows.length === 1 ? 'airport' : 'airports'} with flights to ${destination.city}`}
            </h1>
            <Dropdown open={s.popover === 'sort'} onToggle={() => togglePopover('sort')} align="right" width={220}
              triggerClassName="ghost-button small"
              trigger={<><Icon name="sort" className="muted" />{SORT_LABELS[sortKey][0]}<Icon name="expand_more" className="muted" /></>}>
              <OptionList
                options={(Object.keys(SORT_LABELS) as SortKey[]).filter(k => k !== 'total' || hasHome)
                  .map(k => [k, SORT_LABELS[k][1]] as [SortKey, string])}
                value={sortKey} onPick={sort => set({ sort, popover: null })} />
            </Dropdown>
          </div>
          <div className="age-note"><Icon name="history" size={16} />{ageNote}</div>
          {showStaleBanner && (
            <div className="banner-warning">
              <Icon name="warning" className="warning-icon" />
              <span>Most of these prices are over a week old. Fares have probably changed, so check the live price before you plan around one.</span>
            </div>
          )}
        </div>
      )}

      <div className="list-scroll" ref={listRef}>
        {status.kind === 'loading' && <SkeletonRows />}

        {status.kind === 'rows' && (
          <>
            {rows.map(row => {
              const id = row.airport.iata;
              const selected = id === s.selectedId;
              const hovered = id === s.hoverId;
              const tier = TIERS[row.tier];
              const stale = row.ageHours !== null && row.ageHours >= STALE_ROW_HOURS;
              const mode = row.ground ? GROUND_MODE[row.ground.mode] : null;
              return (
                <div key={id} data-id={id} role="button" tabIndex={0}
                  className={`row ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''}`}
                  onMouseEnter={() => set({ hoverId: id })} onMouseLeave={() => set(st => ({ hoverId: st.hoverId === id ? null : st.hoverId }))}
                  onClick={() => select(id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); } }}
                >
                  <div className="row-main">
                    <div className="row-title">
                      <span className="row-city">{row.airport.city}</span>
                      <span className="row-code">{id}</span>
                      <span className="row-country">{row.airport.country}</span>
                    </div>
                    <div className="row-line">
                      <span className={row.fare.transfers ? 'stops' : 'stops nonstop'}>{stopsLabel(row.fare.transfers)}</span>
                      {' · '}{formatDuration(row.durationMinutes)}
                      {row.fare.airlines.length > 0 && <> · {row.fare.airlines.join(', ')}</>}
                    </div>
                    <div className="row-meta">
                      <span>{dateRange(row.fare.departure_at, row.fare.return_at)}</span>
                      <span className="dot">·</span>
                      <span className={`age ${stale ? 'is-stale' : ''}`}>
                        <Icon name={stale ? 'warning' : 'history'} size={15} />found {formatAge(row.ageHours)}
                      </span>
                    </div>
                  </div>
                  <div className="row-price">
                    <span className="price-pill" style={selected ? undefined : { background: tier.bg, color: tier.fg, borderColor: tier.bd }}>
                      {money(row.value)}
                    </span>
                    <span className="price-caption">{hasHome ? 'total trip' : priceCaption}</span>
                  </div>
                  {row.ground && mode && (
                    <div className="breakdown">
                      <span className="breakdown-part"><Icon name="flight" size={15} className="muted" /><strong>{money(row.flight)}</strong> flight</span>
                      <span className="faint">+</span>
                      <span className="breakdown-part"><Icon name={mode.icon} size={15} className="muted" /><strong>{money(row.groundCost)}</strong> {mode.label}</span>
                      <span className="faint">=</span>
                      <strong>{money(row.total)}</strong>
                      <span className="breakdown-time">{formatDuration(row.ground.minutes)} each way</span>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="list-footnote">
              Prices are cached from recent searches, not live fares. Ground costs are estimates for the cheapest usual option.
              {(s.adults + s.children + s.infants > 1 || s.cabin !== 'Economy') && ' Cabin and group prices are scaled estimates.'}
            </p>
          </>
        )}

        {status.kind === 'no-destination' && (
          <div className="state-panel">
            <Icon name="flight_land" size={32} className="accent" />
            <div className="state-title">Where do you want to go?</div>
            <div className="state-body">Pick a destination and we’ll show every airport you could fly from, with prices on the map.</div>
            <div className="chip-row wrap">
              {destinationPicks.map(d => <button type="button" key={d.label} className="pill-button" onClick={d.pick}>{d.label}</button>)}
            </div>
          </div>
        )}

        {status.kind === 'empty' && (
          <div className="state-panel">
            <Icon name="search" size={30} className="faint" />
            <div className="state-title">{status.title}</div>
            <div className="state-body">{status.body}</div>
            <div className="column gap-8">
              {status.suggestions.map(g => (
                <button type="button" key={g.label} className="suggestion" onClick={g.pick}>
                  <span>{g.label}</span><span className="subtle">{g.note}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="state-panel">
            <Icon name="error" size={30} className="danger" />
            <div className="state-title">We couldn’t load prices</div>
            <div className="state-body">The fare cache didn’t respond. Your search and filters are kept, so try again in a moment.</div>
            <button type="button" className="primary-button with-icon" onClick={onRetry}><Icon name="refresh" />Try again</button>
          </div>
        )}
      </div>
    </aside>
  );
}

export function stopsLabel(transfers: number): string {
  return transfers === 0 ? 'Nonstop' : transfers === 1 ? '1 stop' : `${transfers} stops`;
}

export function dateRange(depart: string, ret: string | null, arrow = '–'): string {
  return ret ? `${formatDay(depart)} ${arrow} ${formatDay(ret)}` : formatDay(depart);
}

function SkeletonRows() {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.08}s` }}>
          <div>
            <div className="skeleton-bar" style={{ width: 90 + ((i * 37) % 70), height: 14 }} />
            <div className="skeleton-bar" style={{ width: 190, height: 10, marginTop: 10 }} />
            <div className="skeleton-bar" style={{ width: 130, height: 10, marginTop: 8 }} />
          </div>
          <div className="skeleton-bar" style={{ width: 58, height: 26 }} />
        </div>
      ))}
    </div>
  );
}
