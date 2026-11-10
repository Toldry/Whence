import { useCallback, useEffect, useMemo, useState } from 'react';
import { usingMockData, type InboundQuery, type InboundResponse } from './api';
import { countryCodeOf } from './data/regions';
import { DESTINATION_BY_IATA } from './data/places';
import { CURRENCY_NAMES, CURRENCY_RATES, currencySymbol, formatAge, formatMoney, formatMonth } from './lib/format';
import {
  assignTiers, computeRows, fareOptions, SORTERS, tierForBin,
  STALE_LIST_HOURS, type ResultContext, type ResultFilters,
} from './lib/results';
import { useInboundSearch } from './lib/useInboundSearch';
import { departWindow, END_OF_SPAN, initialState, searchMonths, scopeFromState, upcomingMonths, type AppState, type PopoverKey, type StatePatch, type Store } from './state';
import { TIERS } from './theme';
import { FilterBar, type FilterRanges } from './components/FilterBar';
import { MapPanel } from './components/MapPanel';
import { ResultsList, type EmptySuggestion, type ListStatus } from './components/ResultsList';
import { SearchPanel } from './components/SearchPanel';
import type { AirportCounts } from './components/OriginPicker';
import { Dropdown, Icon } from './components/ui';
import { BrandMark } from './components/BrandMark';
import { stateFromParams, urlForState } from './lib/urlState';

/** The starting state: the defaults, overridden by whatever the page URL carries. */
function stateFromUrl(): AppState {
  return stateFromParams(new URLSearchParams(window.location.search), initialState());
}

function useStore(): Store {
  const [state, setState] = useState<AppState>(stateFromUrl);
  const [defaults] = useState<AppState>(initialState);
  // Mirror the search into the URL without adding history entries, so links are shareable.
  useEffect(() => {
    const url = urlForState(state, defaults, window.location);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (url !== current) window.history.replaceState(window.history.state, '', url);
  }, [state, defaults]);
  const set = useCallback((patch: StatePatch) => {
    setState(prev => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);
  const togglePopover = useCallback((key: PopoverKey) => set(s => ({ popover: s.popover === key ? null : key })), [set]);
  const closePopover = useCallback(() => set({ popover: null }), [set]);
  return { state, set, togglePopover, closePopover };
}

/** Re-renders every minute so "found 3 h ago" stays true. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function App() {
  const store = useStore();
  const { state: s, set } = store;
  const now = useNow();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ popover: null }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [set]);

  const departDays = departWindow(s);
  const query: InboundQuery | null = s.destination ? {
    destination: s.destination.iata, trip: s.trip, dateMode: s.dateMode, month: s.month,
    ...(s.monthTo > s.month ? { monthTo: s.monthTo } : {}),
    // Trip length means nothing one way, so ask for every departure day in the month.
    flexKind: s.trip === 'oneway' ? 'week' : s.flexKind, length: s.length, depart: s.depart, returnDate: s.returnDate,
    ...(departDays ? { departFrom: departDays.from, departTo: departDays.to } : {}),
  } : null;
  const search = useInboundSearch(query);

  // A new search clears the selection.
  useEffect(() => {
    if (search.loading) set({ selectedId: null, hoverId: null, focusPoint: null });
  }, [search.loading, set]);

  const context: ResultContext = useMemo(() => ({
    response: search.loading ? null : search.response,
    destination: s.destination,
    trip: s.trip,
    cabin: s.cabin,
    travellers: { adults: s.adults, children: s.children, infants: s.infants },
    home: s.includeGround ? s.home : null,
    now,
  }), [search.loading, search.response, s.destination, s.trip, s.cabin, s.adults, s.children, s.infants, s.includeGround, s.home, now]);

  const filters: ResultFilters = {
    scope: scopeFromState(s.from), stops: s.stops, maxPrice: s.maxPrice,
    airlines: s.airlines, maxDurationHours: s.maxDurationHours,
    // The back end narrows by these days too; filtering here keeps an older back end honest.
    departWindow: departDays,
  };
  const sortKey = s.sort === 'total' && !context.home ? 'price' : s.sort;
  const rows = computeRows(context, filters).sort(SORTERS[sortKey]);
  const binStarts = assignTiers(rows);
  const totalFares = context.response?.fares.length ?? 0;

  const status: ListStatus = !s.destination ? { kind: 'no-destination' }
    : search.loading ? { kind: 'loading' }
      : search.error ? { kind: 'error' }
        : rows.length ? { kind: 'rows' }
          : emptyStatus(s, set, totalFares === 0, context, filters);

  const money = (v: number) => formatMoney(v, s.currency);
  const pax = s.adults + s.children + s.infants;
  const priceCaption = (s.trip === 'round' ? 'round trip' : 'one way') + (pax > 1 ? ` · ${pax} travellers` : '');

  const knownAges = rows.map(r => r.ageHours).filter((h): h is number => h !== null).sort((a, b) => a - b);
  const ageNote = status.kind === 'loading' ? 'Searching cached fares…'
    : knownAges.length ? `Cached prices, found ${formatAge(knownAges[0])} to ${formatAge(knownAges[knownAges.length - 1])}`
      : 'Cached prices, typically 2–7 days old';
  const ageNoteWithSource = context.response?.meta?.stale
    ? `${ageNote}. The fare service didn’t respond, so this is an older saved answer.` : ageNote;
  const medianAge = knownAges.length ? knownAges[Math.floor(knownAges.length / 2)] : 0;

  const ranges = filterRanges(context, filters);
  const legend = binStarts.map((v, i) => ({
    color: TIERS[tierForBin(i, binStarts.length)].bd, label: money(v) + (i ? '+' : ''),
  }));
  const airportCounts = useMemo(() => countAirportsByCountry(context.response, s.destination?.iata), [context.response, s.destination?.iata]);
  const scopeMatchCount = status.kind === 'loading' || !s.destination ? null : rows.length;
  const destinationPicks = ['LIS', 'OPO', 'BCN', 'FCO', 'KEF'].map(iata => DESTINATION_BY_IATA[iata]).map(d => ({
    label: `${d.city} (${d.iata})`, pick: () => set({ destination: d }),
  }));

  return (
    <div className={`app view-${s.mobileView}`}>
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">whence</span>
          {usingMockData && <span className="mock-badge" title="Sample prices generated in your browser, not real fares.">demo data</span>}
        </div>
        <div className="grow" />
        <Dropdown open={s.popover === 'currency'} onToggle={() => store.togglePopover('currency')} align="right" width={230}
          triggerClassName="pill-button with-caret"
          trigger={<>{s.currency} · {currencySymbol(s.currency)}<Icon name="expand_more" className="muted" /></>}>
          <div className="option-list">
            {Object.keys(CURRENCY_RATES).map(code => (
              <button type="button" key={code} className={`option ${s.currency === code ? 'is-selected' : ''}`}
                onClick={() => set({ currency: code, popover: null })}>
                <span className="strong currency-code">{code}</span><span className="grow subtle-left">{CURRENCY_NAMES[code]}</span>
                {s.currency === code && <Icon name="check" className="accent" />}
              </button>
            ))}
          </div>
        </Dropdown>
      </header>

      <div className="search-area">
        <SearchPanel store={store} airportCounts={airportCounts} matchCount={scopeMatchCount} />
      </div>
      <FilterBar store={store} ranges={ranges} />

      <main className="workspace">
        <ResultsList
          store={store} rows={rows} status={status} sortKey={sortKey} ageNote={ageNoteWithSource}
          showStaleBanner={status.kind === 'rows' && medianAge >= STALE_LIST_HOURS}
          onRetry={search.retry} destinationPicks={destinationPicks} priceCaption={priceCaption}
        />
        <MapPanel store={store} rows={rows} status={status} legend={legend} priceCaption={priceCaption} />
      </main>

      <div className="view-toggle" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={s.mobileView === 'list'} onClick={() => set({ mobileView: 'list' })}>
          <Icon name="list" />List
        </button>
        <button type="button" role="tab" aria-selected={s.mobileView === 'map'} onClick={() => set({ mobileView: 'map' })}>
          <Icon name="map" />Map
        </button>
      </div>

      {s.popover && s.popover !== 'to' && <div className="popover-scrim" onClick={store.closePopover} />}
    </div>
  );
}

/** Origin airports with at least one fare, per country code; null until a search has answered. */
function countAirportsByCountry(response: InboundResponse | null, destination?: string): AirportCounts {
  if (!response) return null;
  const withFares = new Set(response.fares.map(fare => fare.origin));
  const counts: Record<string, number> = {};
  for (const airport of Object.values(response.airports)) {
    if (airport.iata === destination || !withFares.has(airport.iata)) continue;
    const code = countryCodeOf(airport);
    if (code) counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

function filterRanges(ctx: ResultContext, filters: ResultFilters): FilterRanges {
  const options = fareOptions(ctx);
  // The price slider tops out at the dearest row the other filters still allow,
  // so with "Nonstop only" on it does not stretch to a 3-stop fare nobody can see.
  const pricedRows = computeRows(ctx, { ...filters, maxPrice: null });
  // With a home city set the price filter caps the total trip cost, so the range follows it.
  const priceMax = Math.max(50, Math.ceil(Math.max(0, ...pricedRows.map(r => r.total)) / 10) * 10);
  const durationMax = Math.max(2, Math.ceil(Math.max(0, ...options.map(o => o.durationMinutes)) / 60));
  const airlineFrom: Record<string, number> = {};
  for (const o of options) {
    for (const airline of o.fare.airlines) {
      if (!(airline in airlineFrom) || o.flight < airlineFrom[airline]) airlineFrom[airline] = o.flight;
    }
  }
  return { priceMax, durationMax, airlineFrom };
}

function emptyStatus(
  s: AppState, set: Store['set'], noFaresAtAll: boolean, ctx: ResultContext, filters: ResultFilters,
): ListStatus {
  const city = s.destination!.city;
  if (!noFaresAtAll) {
    const countWith = (patch: Partial<ResultFilters>) => computeRows(ctx, { ...filters, ...patch }).length;
    const candidates: [string, Partial<ResultFilters>, Partial<AppState>][] = [];
    if (s.stops !== 'any') candidates.push(['Allow flights with a stop', { stops: 'any' }, { stops: 'any' }]);
    if (s.maxPrice != null) candidates.push(['Remove the price limit', { maxPrice: null }, { maxPrice: null }]);
    if (s.airlines.length) candidates.push(['Show all airlines', { airlines: [] }, { airlines: [] }]);
    if (s.maxDurationHours != null) candidates.push(['Any flight duration', { maxDurationHours: null }, { maxDurationHours: null }]);
    if (s.from.type !== 'anywhere') {
      candidates.push(['Fly from anywhere', { scope: { type: 'anywhere' } }, { from: { ...s.from, type: 'anywhere' } }]);
    }
    const suggestions: EmptySuggestion[] = candidates
      .map(([label, filterPatch, statePatch]) => ({ label, count: countWith(filterPatch), statePatch }))
      .filter(c => c.count > 0)
      .map(c => ({ label: c.label, note: `${c.count} airports`, pick: () => set(c.statePatch) }));
    return {
      kind: 'empty', title: 'No flights match these filters', suggestions,
      body: `There are cached fares to ${city}, just not for this combination. Loosen one of these:`,
    };
  }
  const months = upcomingMonths();
  const span = searchMonths(s);
  const next = months[(months.indexOf(span[span.length - 1]) + 1) % months.length];
  const suggestions: EmptySuggestion[] = [];
  if (departWindow(s)) {
    const label = span.length > 1
      ? `Any day, ${formatMonth(span[0], 'short')} – ${formatMonth(span[span.length - 1], 'short')}`
      : `Any day in ${formatMonth(s.month)}`;
    suggestions.push({ label, note: span.length > 1 ? 'whole range' : 'whole month', pick: () => set({ departFrom: 1, departTo: END_OF_SPAN }) });
  }
  if (s.dateMode === 'exact') suggestions.push({ label: 'Use flexible dates', note: s.trip === 'round' ? 'any weekend' : 'any day', pick: () => set({ dateMode: 'flex' }) });
  suggestions.push({ label: `Try ${formatMonth(next)}`, note: 'next month', pick: () => set({ dateMode: 'flex', month: next, monthTo: '', departFrom: 1, departTo: END_OF_SPAN }) });
  if (s.trip === 'round' && (s.flexKind !== 'custom' || s.dateMode === 'exact')) {
    suggestions.push({ label: 'Any trip length', note: '1–31 days', pick: () => set({ dateMode: 'flex', flexKind: 'custom', length: 7 }) });
  }
  return {
    kind: 'empty', title: 'No flights found', suggestions,
    body: `Nobody has searched these dates to ${city} recently, so there are no cached prices yet. Widen the search:`,
  };
}
