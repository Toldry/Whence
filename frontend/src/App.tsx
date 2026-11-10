import { useCallback, useEffect, useMemo, useState } from 'react';
import { usingMockData, type InboundQuery } from './api';
import { DESTINATION_BY_IATA, HOME_BY_NAME } from './data/places';
import { CURRENCY_NAMES, CURRENCY_RATES, currencySymbol, formatAge, formatMoney, formatMonth } from './lib/format';
import {
  assignTiers, computeRows, fareOptions, SORTERS,
  STALE_LIST_HOURS, type ResultContext, type ResultFilters,
} from './lib/results';
import { useInboundSearch } from './lib/useInboundSearch';
import { initialState, scopeFromState, upcomingMonths, type AppState, type PopoverKey, type StatePatch, type Store } from './state';
import { TIERS } from './theme';
import { FilterBar, type FilterRanges } from './components/FilterBar';
import { MapPanel } from './components/MapPanel';
import { ResultsList, type EmptySuggestion, type ListStatus } from './components/ResultsList';
import { SearchPanel } from './components/SearchPanel';
import { Dropdown, Icon } from './components/ui';
import { BrandMark } from './components/BrandMark';

function useStore(): Store {
  const [state, setState] = useState<AppState>(initialState);
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

  const query: InboundQuery | null = s.destination ? {
    destination: s.destination.iata, trip: s.trip, dateMode: s.dateMode, month: s.month,
    flexKind: s.flexKind, length: s.length, depart: s.depart, returnDate: s.returnDate,
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
    home: s.includeGround ? HOME_BY_NAME[s.home] ?? null : null,
    now,
  }), [search.loading, search.response, s.destination, s.trip, s.cabin, s.adults, s.children, s.infants, s.includeGround, s.home, now]);

  const filters: ResultFilters = {
    scope: scopeFromState(s.from), stops: s.stops, maxPrice: s.maxPrice,
    airlines: s.airlines, maxDurationHours: s.maxDurationHours,
  };
  const sortKey = s.sort === 'total' && !context.home ? 'price' : s.sort;
  const rows = computeRows(context, filters).sort(SORTERS[sortKey]);
  const thresholds = assignTiers(rows);
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

  const ranges = filterRanges(context);
  const legend = rows.length
    ? [rows.reduce((m, r) => Math.min(m, r.value), Infinity), ...thresholds].map((v, i) => ({
      color: TIERS[i].bd, label: money(v) + (i ? '+' : ''),
    }))
    : [];
  const countries = [...new Set(Object.values(context.response?.airports ?? {})
    .filter(a => a.iata !== s.destination?.iata).map(a => a.country))].sort();
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
        <SearchPanel store={store} countries={countries} matchCount={scopeMatchCount} />
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

function filterRanges(ctx: ResultContext): FilterRanges {
  const options = fareOptions(ctx);
  const priceMax = Math.max(50, Math.ceil(Math.max(0, ...options.map(o => o.flight)) / 10) * 10);
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
  const next = months[(months.indexOf(s.month) + 1) % months.length];
  const suggestions: EmptySuggestion[] = [];
  if (s.dateMode === 'exact') suggestions.push({ label: 'Use flexible dates', note: 'any weekend', pick: () => set({ dateMode: 'flex' }) });
  suggestions.push({ label: `Try ${formatMonth(next)}`, note: 'next month', pick: () => set({ dateMode: 'flex', month: next }) });
  if (s.flexKind !== 'custom' || s.dateMode === 'exact') {
    suggestions.push({ label: 'Any trip length', note: '1–31 days', pick: () => set({ dateMode: 'flex', flexKind: 'custom', length: 7 }) });
  }
  return {
    kind: 'empty', title: 'No flights found', suggestions,
    body: `Nobody has searched these dates to ${city} recently, so there are no cached prices yet. Widen the search:`,
  };
}
