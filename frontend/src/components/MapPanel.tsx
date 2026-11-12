import { useRef } from 'react';
import { MOCK_AIRPORTS } from '../data/places';
import { formatAge, formatDuration, formatMoney, km } from '../lib/format';
import { STALE_ROW_HOURS, type OriginRow } from '../lib/results';
import type { Store } from '../state';
import { ACCENT, TIERS } from '../theme';
import { InboundMap, type MapApi } from './InboundMap';
import { dateRange, GROUND_MODE, SELF_TRANSFER_WARNING, stopsLabel, type ListStatus } from './ResultsList';
import type { SearchProgress } from '../lib/useInboundSearch';
import { SearchProgressPill } from './SearchProgress';
import { Icon } from './ui';

const CARD_WIDTH = 300;
const HALF_CARD = CARD_WIDTH / 2 + 12;

export function MapPanel({ store, rows, status, legend, priceCaption, progress }: {
  store: Store;
  rows: OriginRow[];
  status: ListStatus;
  legend: { color: string; label: string }[];
  priceCaption: string;
  progress: SearchProgress | null;
}) {
  const { state: s, set } = store;
  const apiRef = useRef<MapApi | null>(null);
  const money = (v: number) => formatMoney(v, s.currency);
  const destination = s.destination;
  const home = s.includeGround ? s.home : null;
  const showing = status.kind === 'rows';

  const notice = status.kind === 'loading' ? { icon: 'history', text: 'Loading cached prices…' }
    : status.kind === 'error' ? { icon: 'error', text: 'Prices unavailable right now' }
      : status.kind === 'empty' ? { icon: 'search', text: 'No airports to show' }
        : status.kind === 'no-destination' ? { icon: 'flight_land', text: 'Choose a destination' } : null;

  // The card follows a hovered marker, otherwise the selected one.
  const selectedId = rows.some(r => r.airport.iata === s.selectedId) ? s.selectedId : null;
  const hoverId = s.hoverId && rows.some(r => r.airport.iata === s.hoverId) ? s.hoverId : null;
  const cardId = hoverId ?? selectedId;
  const cardRow = cardId ? rows.find(r => r.airport.iata === cardId) : undefined;
  const focus = s.focusPoint && cardRow && s.focusPoint.id === cardId ? s.focusPoint : null;

  return (
    <div className="map-panel">
      <InboundMap
        items={showing ? rows.map(r => ({
          id: r.airport.iata, lat: r.airport.lat, lon: r.airport.lon, label: money(r.value), tier: r.tier, value: r.value,
        })) : []}
        tiers={TIERS}
        destination={destination ? { iata: destination.iata, city: destination.city, lat: destination.lat, lon: destination.lon } : null}
        home={home}
        loading={status.kind === 'loading'}
        skeleton={MOCK_AIRPORTS.filter(a => a.iata !== destination?.iata)}
        hoverId={s.hoverId}
        selectedId={selectedId}
        focusId={cardId}
        fitRequest={s.fitRequest}
        accent={ACCENT}
        onHover={id => set({ hoverId: id })}
        onSelect={id => set({ selectedId: id, hoverId: null })}
        onFocusPoint={focusPoint => set({ focusPoint })}
        onReady={api => { apiRef.current = api; }}
      />

      <div className="map-controls">
        <div className="map-control-group">
          <button type="button" title="Zoom in" onClick={() => apiRef.current?.zoomIn()}><Icon name="add" size={20} /></button>
          <div className="map-control-sep" />
          <button type="button" title="Zoom out" onClick={() => apiRef.current?.zoomOut()}><Icon name="remove" size={20} /></button>
        </div>
        <button type="button" className="map-control-single" title="Show all origins" onClick={() => apiRef.current?.fitAll()}>
          <Icon name="fit_screen" size={20} />
        </button>
      </div>

      {status.kind === 'loading' && progress ? <SearchProgressPill progress={progress} />
        : notice && <div className="map-notice"><Icon name={notice.icon} className="muted" />{notice.text}</div>}

      {showing && legend.length > 0 && (
        <div className="legend">
          <div className="legend-head"><span>{home ? 'Total trip cost' : 'Flight price'}</span><span className="faint">cheaper → pricier</span></div>
          <div className="legend-scale">
            {legend.map((l, i) => (
              <div key={i} className="legend-step"><div className="legend-swatch" style={{ background: l.color }} /><span>{l.label}</span></div>
            ))}
          </div>
        </div>
      )}

      {cardRow && focus && destination && (
        <RouteCard
          row={cardRow} focus={focus} pinned={cardId === selectedId && (!hoverId || hoverId === selectedId)}
          destination={destination} home={home} money={money} round={s.trip === 'round'} caption={priceCaption}
          onClose={() => set({ selectedId: null })}
        />
      )}
    </div>
  );
}

function RouteCard({ row, focus, pinned, destination, home, money, round, caption, onClose }: {
  row: OriginRow;
  focus: { x: number; y: number; w: number; h: number };
  pinned: boolean;
  destination: { iata: string; city: string };
  home: { name: string } | null;
  money(v: number): string;
  round: boolean;
  caption: string;
  onClose(): void;
}) {
  const mode = row.ground ? GROUND_MODE[row.ground.mode] : null;
  const stale = row.ageHours !== null && row.ageHours >= STALE_ROW_HOURS;

  // Place above the marker, else below, else beside it.
  const legs = row.via ? row.fare.self_transfer?.legs ?? [] : [];
  // Leg prices scaled like the fare (cabin and party).
  const legScale = row.fare.price > 0 ? row.flight / row.fare.price : 1;
  const estimatedHeight = (home ? 300 : 225) + (row.nonstopAlternative ? 20 : 0) + (pinned ? 50 : 0)
    + (legs.length ? 150 + (pinned ? 50 : 0) : 0);
  const clampX = (x: number) => Math.max(HALF_CARD, Math.min(focus.w - HALF_CARD, x));
  let top: number | null = focus.y - 22 - estimatedHeight;
  let left = clampX(focus.x);
  if (top < 8) top = focus.y + 22 + estimatedHeight <= focus.h - 8 ? focus.y + 22 : null;
  if (top === null) {
    top = Math.max(8, Math.min(focus.h - estimatedHeight - 8, focus.y - estimatedHeight / 2));
    left = focus.x > focus.w / 2 ? clampX(focus.x - 186) : clampX(focus.x + 186);
  }

  return (
    <div className={`route-card ${pinned ? 'is-pinned' : ''}`}
      style={{ left, top, maxHeight: Math.max(160, focus.h - top - 8) }}
      onClick={e => e.stopPropagation()}>
      <div className="route-card-head">
        <div className="grow column">
          <div className="row-title"><span className="card-city">{row.airport.city}</span><span className="row-code">{row.airport.iata}</span></div>
          <span className="subtle">{row.airport.name} → {destination.city} · {km(row.km)}</span>
        </div>
        {pinned && <button type="button" className="round-icon-button" title="Close" onClick={onClose}><Icon name="close" /></button>}
      </div>
      <div className="card-facts">
        <div><Icon name="schedule" size={16} className="faint" />
          <span><span className={row.fare.transfers ? 'stops' : 'stops nonstop'}>{stopsLabel(row.fare.transfers)}</span>{row.via && <> in {row.via.city}</>} · {formatDuration(row.durationMinutes)}</span></div>
        {row.fare.airlines.length > 0 && <div><Icon name="flight" size={16} className="faint" /><span>{row.fare.airlines.join(', ')}</span></div>}
        <div><Icon name="calendar_month" size={16} className="faint" />
          <span>{row.fare.return_at ? dateRange(row.fare.departure_at, row.fare.return_at, '→') : `${dateRange(row.fare.departure_at, null)} · one way`}</span></div>
        {row.nonstopAlternative && <div className="subtle indent">Nonstop from {money(row.nonstopAlternative.flight)}</div>}
      </div>
      {legs.length > 0 && row.via && row.fare.self_transfer && (
        <div className="self-transfer-box">
          <div className="self-transfer-head"><Icon name="warning" size={16} />Self-transfer on separate tickets</div>
          <p>{SELF_TRANSFER_WARNING}</p>
          {legs.map((leg, index) => (
            <div key={index} className="card-line">
              <span>{leg.origin} → {leg.destination} · {legTime(leg.departure_at)}{leg.airlines.length ? ` · ${leg.airlines.join(', ')}` : ''}</span>
              <strong>{money(leg.price * legScale)}</strong>
            </div>
          ))}
          <div className="subtle">{formatDuration(row.fare.self_transfer.layover_minutes)} to change planes in {row.via.city}</div>
        </div>
      )}
      {row.ground && mode && home ? (
        <div className="card-total">
          <div className="card-line"><span><Icon name="flight" size={15} className="muted" />Flight {row.airport.iata} → {destination.iata}</span><strong>{money(row.flight)}</strong></div>
          <div className="card-line"><span><Icon name={mode.icon} size={15} className="muted" />
            <span>{row.ground.mode === 'transfer' ? `${home.name} to the airport` : `${home.name} → ${row.airport.city} by ${mode.verb}`} · {formatDuration(row.ground.minutes)}{round ? ' each way, priced both ways' : ''}</span></span>
            <strong>{money(row.groundCost)}</strong></div>
          <div className="card-sep" />
          <div className="card-line card-sum"><span>Total trip</span><span>{money(row.total)}</span></div>
        </div>
      ) : (
        <div className="card-price"><span className="card-price-value">{money(row.flight)}</span><span className="subtle">{caption}</span></div>
      )}
      <div className={`age ${stale ? 'is-stale' : ''}`}>
        <Icon name={stale ? 'warning' : 'history'} size={15} />
        {row.ageHours === null ? 'Price age unknown' : `Price found ${formatAge(row.ageHours)}`}{stale ? ' · may have changed' : ''}
      </div>
      {pinned && legs.length > 0 && legs.map((leg, index) => (
        <a key={index} className="primary-button wide" href={leg.link} target="_blank" rel="noopener noreferrer">
          Check ticket {index + 1}: {leg.origin} → {leg.destination}<Icon name="open_in_new" size={17} />
        </a>
      ))}
      {pinned && !legs.length && (
        <a className="primary-button wide" href={row.fare.link} target="_blank" rel="noopener noreferrer">
          Check live price<Icon name="open_in_new" size={17} />
        </a>
      )}
    </div>
  );
}

/** "Wed 25 Nov, 16:20" in the airport's local time, as the upstream sends it. */
function legTime(departureAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(departureAt);
  if (!match) return departureAt;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const label = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${label}, ${match[4]}`;
}
