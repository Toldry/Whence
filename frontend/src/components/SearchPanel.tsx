import { useEffect, useMemo, useState } from 'react';
import { fareSource, type PlaceSuggestion } from '../api';
import type { Destination } from '../data/places';
import { addDays, formatDay, formatMonth } from '../lib/format';
import type { Store } from '../state';
import { OriginField, type AirportCounts } from './OriginPicker';
import { dateOfSpanDay, daysInMonth, departWindow, END_OF_SPAN, searchMonths, spanBounds, upcomingMonths } from '../state';
import { DualRange, Dropdown, Icon, OptionList, PrimaryButton, sliderPosition } from './ui';

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
  // The text the shown suggestions answer, so a slow reply never passes for
  // the current one; and whether the last lookup failed.
  const [answeredText, setAnsweredText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const open = focused && s.popover === 'to';
  const searching = open && answeredText !== text;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fareSource.searchPlaces(text, controller.signal)
        .then(list => { setSuggestions(list.slice(0, 12)); setFailed(false); setAnsweredText(text); })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]); setFailed(true); setAnsweredText(text);
        });
    }, text ? 150 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [text, open, retryCount]);

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
            onFocus={() => {
              setFocused(true); setText(''); setHighlight(0);
              setSuggestions([]); setAnsweredText(null); set({ popover: 'to' });
            }}
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
        <div className={`popover popover-stretch scroll ${searching ? 'is-searching' : ''}`}
          role="listbox" aria-busy={searching}
        >
          {searching && <div className="popover-progress" aria-hidden="true" />}
          {searching && suggestions.length === 0 && (
            <div className="suggestion-skeletons" aria-label="Searching">
              {[0, 1, 2].map(row => (
                <div key={row} className="suggestion-skeleton" style={{ animationDelay: `${row * 120}ms` }}>
                  <span className="skeleton-dot" />
                  <span className="grow column" style={{ gap: 6 }}>
                    <span className="skeleton-bar" style={{ width: `${55 - row * 10}%`, height: 12 }} />
                    <span className="skeleton-bar" style={{ width: `${40 - row * 5}%`, height: 10 }} />
                  </span>
                  <span className="skeleton-bar" style={{ width: 38, height: 20 }} />
                </div>
              ))}
            </div>
          )}
          {suggestions.map((place, i) => (
            <button type="button" key={place.iata} role="option" aria-selected={i === highlight}
              className={`option option-rich ${i === highlight ? 'is-highlighted' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(place); }} onMouseEnter={() => setHighlight(i)}
            >
              <Icon name="location_on" size={20} className="muted" />
              <span className="grow column">
                <span className="strong">{place.city}, {place.country}</span>
                <span className="subtle">{/airport/i.test(place.name) ? place.name : `${place.name} Airport`}</span>
              </span>
              <span className="code-badge">{place.iata}</span>
            </button>
          ))}
          {!searching && failed && (
            <div className="popover-note">
              Couldn’t load suggestions.{' '}
              <button type="button" className="link-button"
                onMouseDown={e => { e.preventDefault(); setAnsweredText(null); setRetryCount(n => n + 1); }}
              >Try again</button>
            </div>
          )}
          {!searching && !failed && suggestions.length === 0 && (
            <div className="popover-note">
              {text.trim().length < 2
                ? 'Type a city, airport or 3-letter code.'
                : `No airports match “${text}”. Try a city name or a 3-letter code.`}
            </div>
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
  const span = searchMonths(s);
  const firstMonth = span[0];
  const lastMonth = span[span.length - 1];
  const { fromIndex, toIndex, total } = spanBounds(s);
  const narrowed = departWindow(s);
  const spanShort = span.length > 1
    ? `${formatMonth(firstMonth, 'short')} – ${formatMonth(lastMonth, 'short')}`
    : formatMonth(firstMonth, 'short');
  // "Weekend in November 2026", "Weekend in Nov – Jan", or "Weekend, 20 Nov – 5 Dec" once narrowed.
  const when = narrowed
    ? `, ${formatDayRange(narrowed.from, narrowed.to)}`
    : ` in ${span.length > 1 ? spanShort : formatMonth(firstMonth)}`;

  // Month chips pick a range the way a calendar does: the first tap picks one month,
  // a second tap on another month stretches the search from one to the other.
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => { if (s.popover !== 'dates') setAnchor(null); }, [s.popover]);
  const pickMonth = (month: string) => {
    if (anchor && month !== anchor) {
      const [from, to] = anchor < month ? [anchor, month] : [month, anchor];
      // Stretching forwards keeps a start day already chosen in the first month.
      set({ month: from, monthTo: to, departFrom: from === s.month ? s.departFrom : 1, departTo: END_OF_SPAN });
      setAnchor(null);
    } else {
      set({ month, monthTo: '', departFrom: 1, departTo: END_OF_SPAN });
      setAnchor(month);
    }
  };
  const monthHint = anchor ? 'Tap another month for a range'
    : span.length > 1 ? 'Tap a month to start over' : 'Tap two months for a range';

  // Month boundaries on the slider, and each month's name centred on its stretch of days.
  let monthStart = 1;
  const monthMarks = span.map(month => {
    const mark = { month, start: monthStart, end: monthStart + daysInMonth(month) - 1 };
    monthStart = mark.end + 1;
    return mark;
  });

  const value = s.dateMode === 'flex'
    ? !round ? `Any day${when}`
      : s.flexKind === 'weekend' ? `Weekend${when}`
      : s.flexKind === 'week' ? `A week${when}`
        : `${s.length} ${s.length === 1 ? 'day' : 'days'}${when}`
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
              <div className="range-head">
                <span className="control-label">When</span>
                <span className="subtle month-hint">{monthHint}</span>
              </div>
              <div className="month-grid">
                {months.map(month => {
                  const inSpan = month >= firstMonth && month <= lastMonth;
                  const edge = span.length > 1 && (month === firstMonth || month === lastMonth);
                  return (
                    <button type="button" key={month} aria-pressed={inSpan}
                      className={`chip month ${inSpan ? 'is-active' : ''} ${inSpan && span.length > 1 && !edge ? 'is-between' : ''}`}
                      onClick={() => pickMonth(month)}>
                      <span className="strong">{formatMonth(month, 'short')}</span>
                      <span className="month-year">{month.slice(0, 4)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="control-group">
              <div className="range-head">
                <span className="control-label">Leave between</span>
                <span className="day-range-value">
                  {narrowed ? `${formatDay(narrowed.from)} – ${formatDay(narrowed.to)}` : `Any day in ${spanShort}`}
                </span>
              </div>
              <DualRange min={1} max={total} low={fromIndex} high={toIndex}
                lowLabel="Earliest departure day" highLabel="Latest departure day"
                valueText={index => formatDay(dateOfSpanDay(firstMonth, index))}
                ticks={monthMarks.slice(1).map(mark => mark.start - 0.5)}
                // The last day means "to the end", so the range still fits if the months change length.
                onChange={(low, high) => set({ departFrom: low, departTo: high >= total ? END_OF_SPAN : high })} />
              {span.length > 1 ? (
                <div className="span-scale">
                  {monthMarks.map(mark => (
                    <span key={mark.month} style={{ left: sliderPosition((mark.start + mark.end) / 2, 1, total) }}>
                      {formatMonth(mark.month, 'short')}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="range-scale">
                  <span>1 {spanShort}</span>
                  <span>{total} {spanShort}</span>
                </div>
              )}
              {narrowed && (
                <button type="button" className="link-button whole-span"
                  onClick={() => set({ departFrom: 1, departTo: END_OF_SPAN })}>
                  {span.length > 1 ? 'Any day in these months' : 'Whole month'}
                </button>
              )}
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

/** "12–23 Nov", "12 Nov", or "20 Nov – 5 Dec". */
function formatDayRange(from: string, to: string): string {
  const dayMonth = (date: string) => new Date(`${date}T00:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (from === to) return dayMonth(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${dayMonth(to)}`;
  return `${dayMonth(from)} – ${dayMonth(to)}`;
}
