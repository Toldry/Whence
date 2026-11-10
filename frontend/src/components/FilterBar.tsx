import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { fareSource } from '../api';
import { HOMES, type HomeCity } from '../data/places';
import { formatMoney } from '../lib/format';
import type { Store } from '../state';
import { Dropdown, Icon, OptionList } from './ui';

export interface FilterRanges {
  /** Highest flight price (or total trip cost, with a home city set), EUR, rounded up. */
  priceMax: number;
  /** Longest flight in hours, rounded up. */
  durationMax: number;
  /** Cheapest flight per airline, EUR. */
  airlineFrom: Record<string, number>;
}

const halfHours = (h: number) => String(h).replace('.5', '½');

export function FilterBar({ store, ranges }: { store: Store; ranges: FilterRanges }) {
  const { state: s, set, togglePopover } = store;
  const money = (v: number) => formatMoney(v, s.currency);
  const anyFilter = s.stops !== 'any' || s.maxPrice != null || s.airlines.length > 0 || s.maxDurationHours != null;
  const priceLabel = s.includeGround ? 'Max total trip cost' : 'Max flight price';
  const chipClass = (on: boolean) => `chip chip-drop ${on ? 'is-active' : ''}`;

  return (
    <div className="filters" role="toolbar" aria-label="Filters">
      <Dropdown open={s.popover === 'stops'} onToggle={() => togglePopover('stops')} width={240}
        triggerClassName={chipClass(s.stops !== 'any')}
        trigger={<>{s.stops === '0' ? 'Nonstop only' : s.stops === '1' ? '1 stop or fewer' : 'Stops'}<Icon name="expand_more" /></>}>
        <OptionList options={[['any', 'Any number of stops'], ['0', 'Nonstop only'], ['1', '1 stop or fewer']]}
          value={s.stops} onPick={stops => set({ stops, popover: null })} />
      </Dropdown>

      <Dropdown open={s.popover === 'price'} onToggle={() => togglePopover('price')} width={300}
        triggerClassName={chipClass(s.maxPrice != null)}
        trigger={<>{s.maxPrice != null ? `${s.includeGround ? 'Total up to' : 'Up to'} ${money(s.maxPrice)}` : 'Price'}<Icon name="expand_more" /></>}>
        <div className="popover-body roomy">
          <div className="range-head"><span className="control-label">{priceLabel}</span>
            <span className="strong tabular">{s.maxPrice != null ? money(s.maxPrice) : 'Any'}</span></div>
          <input type="range" min={20} max={ranges.priceMax} step={5} value={s.maxPrice ?? ranges.priceMax}
            aria-label={priceLabel}
            onChange={e => { const v = Number(e.target.value); set({ maxPrice: v >= ranges.priceMax ? null : v }); }} />
          <div className="range-scale"><span>{money(20)}</span><span>{money(ranges.priceMax)}</span></div>
          <button type="button" className="link-button" onClick={() => set({ maxPrice: null, popover: null })}>Any price</button>
        </div>
      </Dropdown>

      <Dropdown open={s.popover === 'airlines'} onToggle={() => togglePopover('airlines')} width={300}
        triggerClassName={chipClass(s.airlines.length > 0)}
        trigger={<>{s.airlines.length === 1 ? s.airlines[0] : s.airlines.length ? `${s.airlines.length} airlines` : 'Airlines'}<Icon name="expand_more" /></>}>
        <div className="popover-body tight">
          <div className="range-head padded"><span className="control-label">Airlines</span>
            <button type="button" className="link-button" onClick={() => set({ airlines: [] })}>Show all</button></div>
          <div className="scroll column" style={{ maxHeight: 300 }}>
            {Object.keys(ranges.airlineFrom).sort().map(name => (
              <label key={name} className="check-row">
                <input type="checkbox" checked={s.airlines.includes(name)} onChange={() => set(st => ({
                  airlines: st.airlines.includes(name) ? st.airlines.filter(a => a !== name) : [...st.airlines, name],
                }))} />
                <span className="grow">{name}</span>
                <span className="subtle tabular">from {money(ranges.airlineFrom[name])}</span>
              </label>
            ))}
            {Object.keys(ranges.airlineFrom).length === 0 && <div className="popover-note">No airline data for these fares.</div>}
          </div>
        </div>
      </Dropdown>

      <Dropdown open={s.popover === 'duration'} onToggle={() => togglePopover('duration')} width={300}
        triggerClassName={chipClass(s.maxDurationHours != null)}
        trigger={<>{s.maxDurationHours != null ? `Under ${halfHours(s.maxDurationHours)} h` : 'Duration'}<Icon name="expand_more" /></>}>
        <div className="popover-body roomy">
          <div className="range-head"><span className="control-label">Max flight duration</span>
            <span className="strong tabular">{s.maxDurationHours != null ? `${halfHours(s.maxDurationHours)} h` : 'Any'}</span></div>
          <input type="range" min={1} max={ranges.durationMax} step={0.5} value={s.maxDurationHours ?? ranges.durationMax}
            aria-label="Max flight duration"
            onChange={e => { const v = Number(e.target.value); set({ maxDurationHours: v >= ranges.durationMax ? null : v }); }} />
          <div className="range-scale"><span>1 h</span><span>{ranges.durationMax} h</span></div>
          <button type="button" className="link-button" onClick={() => set({ maxDurationHours: null, popover: null })}>Any duration</button>
        </div>
      </Dropdown>

      {anyFilter && (
        <button type="button" className="link-button chip-height"
          onClick={() => set({ stops: 'any', maxPrice: null, airlines: [], maxDurationHours: null })}>Clear filters</button>
      )}

      <div className="divider" />

      <button type="button" className={`chip switch-chip ${s.includeGround ? 'is-active' : ''}`} role="switch"
        aria-checked={s.includeGround}
        onClick={() => set(st => ({
          includeGround: !st.includeGround,
          // The price limit switches between flight-only and total cost, so an old value would mislead.
          maxPrice: null,
          sort: !st.includeGround ? 'total' : st.sort === 'total' ? 'price' : st.sort,
        }))}>
        <span className="switch-track"><span className="switch-knob" /></span>
        Include getting to the airport
      </button>
      <GroundInfo store={store} />

      {s.includeGround && <HomePicker store={store} />}
    </div>
  );
}

/** Same city twice (a preset and a search hit, or a city and its airport) shows once. */
const homeKey = (h: HomeCity) => `${h.name}|${h.country}`.toLowerCase();

function HomePicker({ store }: { store: Store }) {
  const { state: s, set, togglePopover } = store;
  const open = s.popover === 'home';
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<HomeCity[]>([]);
  const [searching, setSearching] = useState(false);
  const needle = query.trim().toLowerCase();

  // Any city the back end knows (every city with an airport), looked up as you type.
  useEffect(() => {
    if (!open || needle.length < 2) { setFound([]); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      fareSource.searchPlaces(needle, controller.signal)
        .then(list => setFound(list.map(p => ({ name: p.city, iata: p.iata, country: p.country, lat: p.lat, lon: p.lon }))))
        .catch(() => { if (!controller.signal.aborted) setFound([]); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [needle, open]);

  const presets = HOMES.filter(h => !needle || h.name.toLowerCase().includes(needle));
  const seen = new Set<string>();
  const homes = [...(needle ? [] : [s.home]), ...presets, ...found]
    .filter(h => !seen.has(homeKey(h)) && seen.add(homeKey(h)))
    .slice(0, 40);
  const pick = (home: HomeCity) => { set({ home, popover: null }); setQuery(''); };
  const isCurrent = (h: HomeCity) => homeKey(h) === homeKey(s.home);

  return (
    <Dropdown open={open} onToggle={() => togglePopover('home')} width={320}
      triggerClassName="chip chip-drop"
      trigger={<><Icon name="home" className="muted" />from <strong>{s.home.name}</strong><Icon name="expand_more" className="muted" /></>}>
      <div className="popover-body">
        <p className="popover-explainer">
          Each airport gets an estimate for train, bus or a short flight from your home city, there and back.
          Search any city with an airport; from a smaller town, pick the nearest one.
        </p>
        <label className="search-input">
          <Icon name="search" className="faint" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search for your home city"
            aria-label="Your home city" autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && needle && homes[0]) { e.preventDefault(); pick(homes[0]); } }} />
        </label>
        <div className="scroll column" style={{ maxHeight: 240 }}>
          {homes.map(h => (
            <button type="button" key={homeKey(h)} className={`option ${isCurrent(h) ? 'is-selected' : ''}`}
              onClick={() => pick(h)}>
              <span className="grow"><span className="strong">{h.name}</span>{h.country && <span className="subtle">, {h.country}</span>}</span>
              {isCurrent(h) && <Icon name="check" className="accent" />}
            </button>
          ))}
          {needle && !homes.length && (
            <div className="popover-note">{searching ? 'Searching…' : `No cities match “${query.trim()}”.`}</div>
          )}
        </div>
      </div>
    </Dropdown>
  );
}

/**
 * The ⓘ next to the toggle. A mouse hover previews the explanation; a click, tap or
 * Enter pins it open through the shared popover state, so Escape and the scrim close it.
 */
function GroundInfo({ store }: { store: Store }) {
  const { state: s, togglePopover } = store;
  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const pinned = s.popover === 'groundInfo';
  const open = pinned || hovered;
  // Touch taps also fire pointerenter but never pointerleave, so only a mouse may hover-open.
  // Closing waits a moment so the mouse can cross the gap between the button and the panel.
  const onHover = (value: boolean) => (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer.current);
    if (value) setHovered(true);
    else closeTimer.current = window.setTimeout(() => setHovered(false), 150);
  };
  return (
    <div className="dropdown info-tip" onPointerEnter={onHover(true)} onPointerLeave={onHover(false)}>
      <button type="button" className="round-icon-button info-button" aria-label="How getting to the airport is estimated"
        aria-expanded={open} aria-controls="ground-info" onClick={() => { window.clearTimeout(closeTimer.current); setHovered(false); togglePopover('groundInfo'); }}>
        <Icon name="info" size={20} />
      </button>
      {open && (
        <div id="ground-info" className="popover popover-left info-popover" role="region"
          aria-label="How getting to the airport is estimated">
          <GroundExplanation />
        </div>
      )}
    </div>
  );
}

function GroundExplanation() {
  return (
    <div className="popover-body info-body">
      <p><strong>What it does.</strong> Each departure airport gets an estimate of what it costs to get there
        from your home city, and back again on a round trip. That is added to the flight price, the list is
        sorted by <strong>total cost</strong>, and the map colours follow the total, so a cheap flight from
        a far-away airport no longer looks cheaper than it is.</p>
      <p><strong>How it’s estimated.</strong> The distance is the straight line from your home city to the
        airport, plus 20% for roads and rails. Then the cheapest usual way is picked:</p>
      <table className="info-table">
        <tbody>
          <tr><th>Under 45 km</th><td>Airport transfer, about €9 and 50 min</td></tr>
          <tr><th>Under 220 km</th><td>Bus, €6 + €0.07/km, at about 65 km/h</td></tr>
          <tr><th>Under 1,150 km</th><td>Train, €14 + €0.105/km, at about 115 km/h. Britain to the
            mainland goes by Channel Tunnel up to 800 km, with €30 added.</td></tr>
          <tr><th>Farther, or over sea</th><td>A short flight, €48 + €0.045/km, plus about 2½ h
            of airport time. Across the Atlantic it starts at €290.</td></tr>
        </tbody>
      </table>
      <p><strong>Who pays.</strong> Prices are per adult and one way. Round trips count twice, children
        count at 60% and infants travel free. Cabin class does not change the ground cost.</p>
      <p><strong>What it leaves out.</strong> These are rules of thumb, not timetables or real fares. They
        don’t know about driving, parking, rail passes, night travel or a missing direct route. Islands
        such as Mallorca, the Canaries or Iceland always count as a flight. While this is on, the price
        filter caps the total trip cost. Travel time is shown on each row but is not added to the flight
        duration, so the duration filter and sort look at the flight alone. Home is a city centre, so from a smaller town pick the nearest city.</p>
    </div>
  );
}
