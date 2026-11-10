import { useState } from 'react';
import { HOMES } from '../data/places';
import { formatMoney } from '../lib/format';
import type { Store } from '../state';
import { Dropdown, Icon, OptionList } from './ui';

export interface FilterRanges {
  /** Highest flight price across all fares, EUR, rounded up. */
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
        trigger={<>{s.maxPrice != null ? `Up to ${money(s.maxPrice)}` : 'Price'}<Icon name="expand_more" /></>}>
        <div className="popover-body roomy">
          <div className="range-head"><span className="control-label">Max flight price</span>
            <span className="strong tabular">{s.maxPrice != null ? money(s.maxPrice) : 'Any'}</span></div>
          <input type="range" min={20} max={ranges.priceMax} step={5} value={s.maxPrice ?? ranges.priceMax}
            aria-label="Max flight price"
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
          sort: !st.includeGround ? 'total' : st.sort === 'total' ? 'price' : st.sort,
        }))}>
        <span className="switch-track"><span className="switch-knob" /></span>
        Include getting to the airport
      </button>

      {s.includeGround && <HomePicker store={store} />}
    </div>
  );
}

function HomePicker({ store }: { store: Store }) {
  const { state: s, set, togglePopover } = store;
  const [query, setQuery] = useState('');
  const homes = HOMES.filter(h => !query || h.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dropdown open={s.popover === 'home'} onToggle={() => togglePopover('home')} width={320}
      triggerClassName="chip chip-drop"
      trigger={<><Icon name="home" className="muted" />from <strong>{s.home}</strong><Icon name="expand_more" className="muted" /></>}>
      <div className="popover-body">
        <p className="popover-explainer">
          Each airport gets an estimate for train, bus or a short flight from your home city, there and back.
          Sort by total to find the real cheapest start.
        </p>
        <label className="search-input">
          <Icon name="search" className="faint" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Your home city" aria-label="Your home city" />
        </label>
        <div className="scroll column" style={{ maxHeight: 240 }}>
          {homes.map(h => (
            <button type="button" key={h.name} className={`option ${s.home === h.name ? 'is-selected' : ''}`}
              onClick={() => { set({ home: h.name, popover: null }); setQuery(''); }}>
              <span className="grow"><span className="strong">{h.name}</span><span className="subtle">, {h.country}</span></span>
              {s.home === h.name && <Icon name="check" className="accent" />}
            </button>
          ))}
        </div>
      </div>
    </Dropdown>
  );
}
