import { useEffect, useMemo, useState } from 'react';
import { fareSource, type PlaceSuggestion } from '../api';
import type { Destination } from '../data/places';
import { addDays, formatDay, formatMonth } from '../lib/format';
import type { Store } from '../state';
import { OriginField, type AirportCounts } from './OriginPicker';
import { upcomingMonths } from '../state';
import { Dropdown, Icon, OptionList, PrimaryButton } from './ui';

const CABINS = ['Economy', 'Premium economy', 'Business', 'First'] as const;

export function SearchPanel({ store, airportCounts, matchCount }: {
  store: Store;
  /** Origin airports with fares per country, for the counts in the "From" picker. */
  airportCounts: AirportCounts;
  matchCount: number | null;
}) {
  const { state: s, set, togglePopover, closePopover } = store;
  const pax = s.adults + s.children + s.infants;

  return (
    <section className="search-card" aria-label="Search">
      <div className="search-toggles">
        <Dropdown
          open={s.popover === 'trip'} onToggle={() => togglePopover('trip')} width={200}
          triggerClassName="ghost-button"
          trigger={<>
            <Icon name={s.trip === 'round' ? 'sync_alt' : 'arrow_right_alt'} className="muted" />
            {s.trip === 'round' ? 'Round trip' : 'One way'}<Icon name="expand_more" className="muted" /></>}
        >
          <OptionList
            options={[['round', 'Round trip', 'sync_alt'], ['oneway', 'One way', 'arrow_right_alt']]} value={s.trip}
            onPick={trip => set({ trip, popover: null })}
          />
        </Dropdown>

        <Dropdown
          open={s.popover === 'pax'} onToggle={() => togglePopover('pax')} width={290}
          triggerClassName="ghost-button" label={`${pax} travellers`}
          trigger={<><Icon name="person" className="muted" />{pax}<Icon name="expand_more" className="muted" /></>}
        >
          <div className="popover-body">
            {([
              ['adults', 'Adults', '12 and over', 1],
              ['children', 'Children', '2–11', 0],
              ['infants', 'Infants', 'Under 2, on lap', 0],
            ] as const).map(([key, label, sub, min]) => {
              const n = s[key];
              const max = key === 'infants' ? s.adults : 9;
              const canDec = n > min;
              const canInc = n < max && pax < 9;
              return (
                <div className="stepper-row" key={key}>
                  <div className="grow"><div className="strong">{label}</div><div className="subtle">{sub}</div></div>
                  <button type="button" className="square-button" disabled={!canDec} aria-label={`Fewer ${label.toLowerCase()}`}
                    onClick={() => set(st => {
                      const value = Math.max(min, st[key] - 1);
                      return key === 'adults' && st.infants > value ? { adults: value, infants: value } : { [key]: value };
                    })}
                  ><Icon name="remove" /></button>
                  <span className="stepper-value">{n}</span>
                  <button type="button" className="square-button" disabled={!canInc} aria-label={`More ${label.toLowerCase()}`}
                    onClick={() => set(st => ({ [key]: Math.min(max, st[key] + 1) }))}
                  ><Icon name="add" /></button>
                </div>
              );
            })}
            <div className="popover-footer end"><PrimaryButton onClick={closePopover}>Done</PrimaryButton></div>
          </div>
        </Dropdown>

        <Dropdown
          open={s.popover === 'cabin'} onToggle={() => togglePopover('cabin')} width={220}
          triggerClassName="ghost-button"
          trigger={<>{s.cabin}<Icon name="expand_more" className="muted" /></>}
        >
          <OptionList options={CABINS.map(c => [c, c] as [string, string])} value={s.cabin}
            onPick={cabin => set({ cabin, popover: null })} />
        </Dropdown>
      </div>

      <div className="search-fields">
        <OriginField store={store} airportCounts={airportCounts} matchCount={matchCount} />
        <DestinationField store={store} />
        <DatesField store={store} />
      </div>
    </section>
  );
}

function DestinationField({ store }: { store: Store }) {
  const { state: s, set } = store;
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const open = focused && s.popover === 'to';

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fareSource.searchPlaces(text, controller.signal)
        .then(list => { setSuggestions(list.slice(0, 12)); setLoaded(true); })
        .catch(() => { if (!controller.signal.aborted) { setSuggestions([]); setLoaded(true); } });
    }, text ? 150 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, open]);

  const pick = (place: PlaceSuggestion) => {
    const destination: Destination = {
      iata: place.iata, city: place.city, country: place.country, airport: place.name, lat: place.lat, lon: place.lon,
    };
    set({ destination, popover: null, selectedId: null, hoverId: null });
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const missing = !s.destination && !focused;
  return (
    <div className="field-wrap field-to">
      <label className={`field ${missing ? 'is-error' : ''} ${focused ? 'is-focused' : ''}`}>
        <Icon name="flight_land" size={22} className="accent" />
        <span className="field-text">
          <span className="field-label">{missing ? 'To · choose a destination' : 'To'}</span>
          <input
            className="field-input"
            value={focused ? text : s.destination ? `${s.destination.city} (${s.destination.iata})` : ''}
            placeholder="City or airport"
            role="combobox" aria-expanded={open} aria-autocomplete="list"
            onFocus={() => { setFocused(true); setText(''); setHighlight(0); setLoaded(false); set({ popover: 'to' }); }}
            onBlur={() => { setFocused(false); set(st => ({ popover: st.popover === 'to' ? null : st.popover })); }}
            onChange={e => { setText(e.target.value); setHighlight(0); set({ popover: 'to' }); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(suggestions.length - 1, h + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
              else if (e.key === 'Enter' && suggestions[highlight]) { e.preventDefault(); pick(suggestions[highlight]); }
              else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
        </span>
        {s.destination && !focused && (
          <button type="button" className="round-icon-button" title="Clear destination"
            onMouseDown={e => { e.preventDefault(); set({ destination: null, selectedId: null, hoverId: null, popover: null }); }}
          ><Icon name="close" /></button>
        )}
      </label>
      {open && (
        <div className="popover popover-stretch scroll" role="listbox">
          {suggestions.map((place, i) => (
            <button type="button" key={place.iata} role="option" aria-selected={i === highlight}
              className={`option option-rich ${i === highlight ? 'is-highlighted' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(place); }} onMouseEnter={() => setHighlight(i)}
            >
              <Icon name="location_on" size={20} className="muted" />
              <span className="grow column">
                <span className="strong">{place.city}, {place.country}</span>
                <span className="subtle">{place.name} Airport</span>
              </span>
              <span className="code-badge">{place.iata}</span>
            </button>
          ))}
          {loaded && suggestions.length === 0 && (
            <div className="popover-note">No airports match “{text}”. Try a city name or a 3-letter code.</div>
          )}
        </div>
      )}
    </div>
  );
}

function DatesField({ store }: { store: Store }) {
  const { state: s, set, togglePopover, closePopover } = store;
  const months = useMemo(() => upcomingMonths(), []);
  const round = s.trip === 'round';
  const today = new Date().toISOString().slice(0, 10);
  const value = s.dateMode === 'flex'
    ? !round ? `Any day in ${formatMonth(s.month)}`
      : s.flexKind === 'weekend' ? `Weekend in ${formatMonth(s.month)}`
      : s.flexKind === 'week' ? `A week in ${formatMonth(s.month)}`
        : `${s.length} ${s.length === 1 ? 'day' : 'days'} in ${formatMonth(s.month)}`
    : round ? `${formatDay(s.depart)} – ${formatDay(s.returnDate)}` : formatDay(s.depart);

  return (
    <Dropdown
      className="field-wrap field-dates" open={s.popover === 'dates'} onToggle={() => togglePopover('dates')}
      width={420} align="right" triggerClassName="field"
      trigger={<>
        <Icon name="calendar_month" size={22} className="muted" />
        <span className="field-text">
          <span className="field-label">{s.dateMode === 'flex' ? 'Dates · flexible' : 'Dates'}</span>
          <span className="field-value">{value}</span>
        </span>
        <Icon name="expand_more" size={20} className="faint" />
      </>}
    >
      <div className="popover-body roomy">
        <div className="segmented">
          {([['flex', 'Flexible'], ['exact', 'Exact dates']] as const).map(([key, label]) => (
            <button type="button" key={key} className={s.dateMode === key ? 'is-selected' : ''}
              onClick={() => set({ dateMode: key })}>{label}</button>
          ))}
        </div>
        {s.dateMode === 'flex' ? (
          <>
            {round && <div className="control-group">
              <span className="control-label">How long</span>
              <div className="chip-row">
                {([['weekend', 'A weekend'], ['week', 'A week'], ['custom', 'Set length']] as const).map(([key, label]) => (
                  <button type="button" key={key} className={`chip grow ${s.flexKind === key ? 'is-active' : ''}`}
                    onClick={() => set({ flexKind: key })}>{label}</button>
                ))}
              </div>
              {s.flexKind === 'custom' && (
                <label className="inline-control">
                  <input type="range" min={1} max={31} value={s.length} aria-label="Trip length in days"
                    onChange={e => set({ length: Number(e.target.value) })} />
                  <span className="range-value">{s.length} {s.length === 1 ? 'day' : 'days'}</span>
                </label>
              )}
            </div>}
            <div className="control-group">
              <span className="control-label">When</span>
              <div className="month-grid">
                {months.map(month => (
                  <button type="button" key={month} className={`chip month ${s.month === month ? 'is-active' : ''}`}
                    onClick={() => set({ month })}>
                    <span className="strong">{formatMonth(month, 'short')}</span>
                    <span className="month-year">{month.slice(0, 4)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="date-inputs">
            <label className="control-group grow">
              <span className="control-label">Depart</span>
              <input type="date" value={s.depart} min={today} onChange={e => {
                const depart = e.target.value;
                if (depart) set(st => ({ depart, returnDate: st.returnDate <= depart ? addDays(depart, 3) : st.returnDate }));
              }} />
            </label>
            {round && (
              <label className="control-group grow">
                <span className="control-label">Return</span>
                <input type="date" value={s.returnDate} min={s.depart}
                  onChange={e => { if (e.target.value) set({ returnDate: e.target.value }); }} />
              </label>
            )}
          </div>
        )}
        <div className="popover-footer">
          <span className="subtle">{s.dateMode === 'flex' ? 'We pick the cheapest cached dates.' : 'Exact dates have fewer cached prices.'}</span>
          <PrimaryButton onClick={closePopover}>Done</PrimaryButton>
        </div>
      </div>
    </Dropdown>
  );
}
