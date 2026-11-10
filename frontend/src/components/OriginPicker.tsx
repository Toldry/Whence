/**
 * The "From" field: fly from anywhere, from any mix of regions or countries, or from
 * airports near any city. Regions and countries cover the whole world (see
 * data/regions.ts), so the lists are searchable, grouped and multi-select.
 */
import { useEffect, useMemo, useState } from 'react';
import { fareSource } from '../api';
import { HOMES } from '../data/places';
import {
  CONTINENTS, COUNTRIES, COUNTRY_BY_CODE, isRegionSelected, REGION_BY_KEY, regionsOfCountry,
  searchCountries, SUBREGIONS, SUBREGIONS_OF, summarizeNames, toggleRegion, type Country,
} from '../data/regions';
import type { FromState, Store } from '../state';
import { Dropdown, Icon, PrimaryButton } from './ui';

/** Origin airports with fares to the current destination, per country code; null before a search. */
export type AirportCounts = Record<string, number> | null;

const TABS: { key: FromState['type']; label: string; icon: string; hint: string }[] = [
  { key: 'anywhere', label: 'Anywhere', icon: 'public', hint: 'Every airport with cached fares to your destination.' },
  { key: 'region', label: 'Regions', icon: 'map', hint: 'Pick whole continents or parts of them.' },
  { key: 'country', label: 'Countries', icon: 'flag', hint: 'Pick one or more countries.' },
  { key: 'near', label: 'Near a city', icon: 'my_location', hint: 'Airports within a distance of any city.' },
];

const formatKm = (km: number) => `${km.toLocaleString('en-GB')} km`;

/** What the closed field shows. An empty pick means no limit, so it reads "Anywhere". */
export function describeOrigin(from: FromState): string {
  if (from.type === 'region' && from.regions.length) {
    return summarizeNames(from.regions.map(key => REGION_BY_KEY[key]?.name ?? key));
  }
  if (from.type === 'country' && from.countries.length) {
    return summarizeNames(from.countries.map(code => COUNTRY_BY_CODE[code]?.name ?? code));
  }
  if (from.type === 'near') return `Within ${formatKm(from.radiusKm)} of ${from.city}`;
  return 'Anywhere';
}

/** Search boxes only grab focus where there is a mouse; on phones that would pop the keyboard over the list. */
const hasFinePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

export function OriginField({ store, matchCount, airportCounts }: {
  store: Store; matchCount: number | null; airportCounts: AirportCounts;
}) {
  const { state: s, set, togglePopover, closePopover } = store;
  const f = s.from;
  const setFrom = (patch: Partial<FromState>) => set(st => ({ from: { ...st.from, ...patch } }));
  const value = describeOrigin(f);
  const unlimited = value === 'Anywhere';
  const picking = (f.type === 'region' && !f.regions.length) || (f.type === 'country' && !f.countries.length);

  return (
    <Dropdown
      className="field-wrap field-from" open={s.popover === 'from'} onToggle={() => togglePopover('from')} width={420}
      triggerClassName="field"
      trigger={<>
        <Icon name="flight_takeoff" size={22} className="muted" />
        <span className="field-text">
          <span className="field-label">From</span>
          <span className={`field-value ${unlimited ? 'is-placeholder' : ''}`}>{value}</span>
        </span>
        <Icon name="expand_more" size={20} className="faint" />
      </>}
    >
      <div className="popover-body origin-body">
        <div className="segmented origin-tabs" role="tablist" aria-label="Where to fly from">
          {TABS.map(tab => (
            <button type="button" role="tab" key={tab.key} aria-selected={f.type === tab.key}
              className={f.type === tab.key ? 'is-selected' : ''} onClick={() => setFrom({ type: tab.key })}>
              <Icon name={tab.icon} size={16} className="origin-tab-icon" />{tab.label}
            </button>
          ))}
        </div>
        <p className="popover-explainer origin-hint">{TABS.find(t => t.key === f.type)?.hint}</p>

        {f.type === 'region' && (
          <RegionPicker selected={f.regions} counts={airportCounts} onChange={regions => setFrom({ regions })} />
        )}
        {f.type === 'country' && (
          <CountryPicker selected={f.countries} counts={airportCounts} onChange={countries => setFrom({ countries })} />
        )}
        {f.type === 'near' && <NearPicker from={f} onChange={setFrom} />}

        <div className="popover-footer">
          <span className="subtle">
            {matchCount == null ? '' : `${matchCount} ${matchCount === 1 ? 'airport' : 'airports'} with fares`
              + (picking ? ', from anywhere until you pick' : '')}
          </span>
          <PrimaryButton onClick={closePopover}>Done</PrimaryButton>
        </div>
      </div>
    </Dropdown>
  );
}

function SelectedChips({ items, onRemove, onClear }: {
  items: { key: string; label: string }[]; onRemove(key: string): void; onClear(): void;
}) {
  if (!items.length) return null;
  return (
    <div className="selected-chips">
      {items.map(item => (
        <button type="button" key={item.key} className="chip is-active chip-removable"
          aria-label={`Remove ${item.label}`} onClick={() => onRemove(item.key)}>
          {item.label}<Icon name="close" size={16} />
        </button>
      ))}
      {items.length > 1 && <button type="button" className="link-button chip-height" onClick={onClear}>Clear all</button>}
    </div>
  );
}

function CheckRow({ checked, mixed, label, sub, count, nested, onToggle }: {
  checked: boolean; mixed?: boolean; label: string; sub?: string; count?: number | null; nested?: boolean;
  onToggle(): void;
}) {
  const box = checked ? 'check_box' : mixed ? 'indeterminate_check_box' : 'check_box_outline_blank';
  return (
    <button type="button" role="checkbox" aria-checked={checked ? true : mixed ? 'mixed' : false}
      className={`option pick-row ${nested ? 'is-nested' : ''} ${checked ? 'is-selected' : ''} ${count === 0 ? 'is-empty' : ''}`}
      onClick={onToggle}>
      <Icon name={box} size={20} className={checked || mixed ? 'accent' : 'faint'} />
      <span className="grow pick-label">
        <span className={nested ? '' : 'strong'}>{label}</span>
        {sub && <span className="subtle"> · {sub}</span>}
      </span>
      {count != null && (
        <span className="pick-count" title={`${count} ${count === 1 ? 'airport' : 'airports'} with fares`}>
          {count || '–'}
        </span>
      )}
    </button>
  );
}

function regionCounts(counts: AirportCounts): Record<string, number> | null {
  if (!counts) return null;
  const totals: Record<string, number> = {};
  for (const [code, n] of Object.entries(counts)) {
    for (const region of regionsOfCountry(code)) totals[region] = (totals[region] ?? 0) + n;
  }
  return totals;
}

function RegionPicker({ selected, counts, onChange }: {
  selected: string[]; counts: AirportCounts; onChange(regions: string[]): void;
}) {
  const totals = useMemo(() => regionCounts(counts), [counts]);
  const countOf = (key: string) => (totals ? totals[key] ?? 0 : null);
  return (
    <>
      <SelectedChips
        items={selected.map(key => ({ key, label: REGION_BY_KEY[key]?.name ?? key }))}
        onRemove={key => onChange(selected.filter(k => k !== key))} onClear={() => onChange([])}
      />
      <div className="pick-list scroll" role="group" aria-label="Regions">
        {CONTINENTS.map(continent => {
          const subs = SUBREGIONS_OF[continent.key];
          const checked = selected.includes(continent.key);
          const mixed = !checked && subs.some(sub => selected.includes(sub));
          return (
            <div key={continent.key} className="pick-group">
              <CheckRow checked={checked} mixed={mixed} label={continent.name} count={countOf(continent.key)}
                onToggle={() => onChange(toggleRegion(mixed ? selected.filter(k => !subs.includes(k)) : selected, continent.key))} />
              {subs.map(sub => (
                <CheckRow key={sub} nested checked={isRegionSelected(selected, sub)} label={REGION_BY_KEY[sub].name}
                  count={countOf(sub)} onToggle={() => onChange(toggleRegion(selected, sub))} />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function CountryPicker({ selected, counts, onChange }: {
  selected: string[]; counts: AirportCounts; onChange(countries: string[]): void;
}) {
  const [query, setQuery] = useState('');
  const [onlyWithFares, setOnlyWithFares] = useState(false);
  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code]);
  const countOf = (code: string) => (counts ? counts[code] ?? 0 : null);
  const keep = (c: Country) => !onlyWithFares || !counts || (counts[c.code] ?? 0) > 0;
  const matches = useMemo(() => searchCountries(query), [query]).filter(keep);
  const searching = query.trim() !== '';
  const withFares = counts ? COUNTRIES.filter(c => (counts[c.code] ?? 0) > 0).length : 0;

  const row = (c: Country, showRegion: boolean) => (
    <CheckRow key={c.code} checked={selected.includes(c.code)} label={c.name} count={countOf(c.code)}
      sub={showRegion ? REGION_BY_KEY[c.subregion]?.name : undefined} onToggle={() => toggle(c.code)} />
  );

  return (
    <>
      <SelectedChips
        items={selected.map(code => ({ key: code, label: COUNTRY_BY_CODE[code]?.name ?? code }))}
        onRemove={code => onChange(selected.filter(c => c !== code))} onClear={() => onChange([])}
      />
      <div className="pick-tools">
        <label className="search-input grow">
          <Icon name="search" className="faint" />
          <input value={query} onChange={e => setQuery(e.target.value)} autoFocus={hasFinePointer()}
            placeholder={`Search ${COUNTRIES.length} countries`} aria-label="Search countries"
            onKeyDown={e => {
              if (e.key === 'Enter' && searching && matches[0]) { e.preventDefault(); toggle(matches[0].code); setQuery(''); }
            }} />
          {searching && (
            <button type="button" className="icon-button-plain" aria-label="Clear search" onClick={() => setQuery('')}>
              <Icon name="close" size={18} />
            </button>
          )}
        </label>
        {counts && (
          <button type="button" className={`chip ${onlyWithFares ? 'is-active' : ''}`} aria-pressed={onlyWithFares}
            title="Hide countries with no cached fares to this destination" onClick={() => setOnlyWithFares(v => !v)}>
            With fares ({withFares})
          </button>
        )}
      </div>
      <div className="pick-list scroll" role="group" aria-label="Countries">
        {searching
          ? matches.map(c => row(c, true))
          : SUBREGIONS.map(sub => {
            const members = matches.filter(c => c.subregion === sub.key);
            if (!members.length) return null;
            return (
              <div key={sub.key} className="pick-group">
                <div className="pick-heading">{sub.name}</div>
                {members.map(c => row(c, false))}
              </div>
            );
          })}
        {!matches.length && (
          <div className="popover-note">
            {searching ? `No countries match “${query.trim()}”.` : 'No country has cached fares to this destination.'}
          </div>
        )}
      </div>
    </>
  );
}

interface CityOption { name: string; country: string; lat: number; lon: number }
const cityKey = (c: CityOption) => `${c.name}|${c.country}`.toLowerCase();

function NearPicker({ from, onChange }: { from: FromState; onChange(patch: Partial<FromState>): void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CityOption[]>([]);
  const [searching, setSearching] = useState(false);
  const needle = query.trim().toLowerCase();

  // Any city with an airport, looked up as you type, like the home city picker.
  useEffect(() => {
    if (needle.length < 2) { setFound([]); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      fareSource.searchPlaces(needle, controller.signal)
        .then(list => setFound(list.map(p => ({ name: p.city, country: p.country, lat: p.lat, lon: p.lon }))))
        .catch(() => { if (!controller.signal.aborted) setFound([]); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [needle]);

  const seen = new Set<string>();
  const options = (needle ? [...HOMES.filter(h => h.name.toLowerCase().includes(needle)), ...found] : [])
    .filter(c => !seen.has(cityKey(c)) && seen.add(cityKey(c)))
    .slice(0, 30);
  const pick = (city: CityOption) => {
    onChange({ city: city.name, cityLat: city.lat, cityLon: city.lon });
    setQuery('');
  };

  return (
    <div className="near-controls">
      <label className="inline-control">
        <span className="control-label">Radius</span>
        <input type="range" min={100} max={2000} step={50} value={from.radiusKm}
          onChange={e => onChange({ radiusKm: Number(e.target.value) })} />
        <span className="range-value">{formatKm(from.radiusKm)}</span>
      </label>
      <label className="search-input">
        <Icon name="location_on" className="accent" />
        <input value={query} onChange={e => setQuery(e.target.value)} autoFocus={hasFinePointer()}
          placeholder="Search for another city" aria-label="City to search around"
          onKeyDown={e => { if (e.key === 'Enter' && options[0]) { e.preventDefault(); pick(options[0]); } }} />
      </label>
      {!needle && (
        <div className="option is-selected near-current">
          <span className="grow">Around <span className="strong">{from.city}</span></span>
          <Icon name="check" className="accent" />
        </div>
      )}
      {needle && (
        <div className="pick-list short scroll" role="listbox" aria-label="Cities">
          {options.map(c => (
            <button type="button" role="option" aria-selected={false} key={cityKey(c)} className="option" onClick={() => pick(c)}>
              <span className="grow"><span className="strong">{c.name}</span>{c.country && <span className="subtle">, {c.country}</span>}</span>
            </button>
          ))}
          {!options.length && (
            <div className="popover-note">{searching ? 'Searching…' : `No cities match “${query.trim()}”.`}</div>
          )}
        </div>
      )}
    </div>
  );
}
