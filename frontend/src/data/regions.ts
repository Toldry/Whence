/**
 * Where an origin airport is: countries and the regions they group into.
 * Regions follow the UN geoscheme (M49): five continents, each split into
 * subregions (South America, Western Africa...). The country list itself is
 * generated from the back end's reference data by scripts/build-countries.mjs.
 */
import type { AirportInfo } from '../api/types';
import { COUNTRY_ROWS } from './countries.generated';

export interface Region {
  key: string;
  name: string;
  /** Set on subregions: the continent they belong to. */
  parent?: string;
}

export interface Country {
  code: string;
  name: string;
  subregion: string;
  continent: string;
}

const TAXONOMY: [string, string, [string, string][]][] = [
  ['africa', 'Africa', [
    ['northern-africa', 'Northern Africa'], ['western-africa', 'Western Africa'],
    ['middle-africa', 'Middle Africa'], ['eastern-africa', 'Eastern Africa'],
    ['southern-africa', 'Southern Africa'],
  ]],
  ['americas', 'Americas', [
    ['northern-america', 'Northern America'], ['central-america', 'Central America'],
    ['caribbean', 'Caribbean'], ['south-america', 'South America'],
  ]],
  ['asia', 'Asia', [
    ['western-asia', 'Western Asia'], ['central-asia', 'Central Asia'], ['southern-asia', 'Southern Asia'],
    ['eastern-asia', 'Eastern Asia'], ['south-eastern-asia', 'South-eastern Asia'],
  ]],
  ['europe', 'Europe', [
    ['northern-europe', 'Northern Europe'], ['western-europe', 'Western Europe'],
    ['eastern-europe', 'Eastern Europe'], ['southern-europe', 'Southern Europe'],
  ]],
  ['oceania', 'Oceania', [
    ['australia-and-new-zealand', 'Australia and New Zealand'], ['melanesia', 'Melanesia'],
    ['micronesia', 'Micronesia'], ['polynesia', 'Polynesia'],
  ]],
];

export const CONTINENTS: Region[] = TAXONOMY.map(([key, name]) => ({ key, name }));
export const SUBREGIONS: Region[] = TAXONOMY.flatMap(([parent, , subs]) =>
  subs.map(([key, name]) => ({ key, name, parent })));
export const REGION_BY_KEY: Record<string, Region> = Object.fromEntries(
  [...CONTINENTS, ...SUBREGIONS].map(r => [r.key, r]));
export const SUBREGIONS_OF: Record<string, string[]> = Object.fromEntries(
  TAXONOMY.map(([key, , subs]) => [key, subs.map(([sub]) => sub)]));

export const COUNTRIES: Country[] = COUNTRY_ROWS.map(([code, name, subregion]) => ({
  code, name, subregion, continent: REGION_BY_KEY[subregion]?.parent ?? '',
}));
export const COUNTRY_BY_CODE: Record<string, Country> = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));

/** Other names people type, and names the fare data or older links use. */
const ALIASES: Record<string, string[]> = {
  GB: ['UK', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  US: ['USA', 'America', 'United States of America'],
  AE: ['UAE', 'Emirates', 'Dubai'],
  NL: ['Holland'],
  TR: ['Turkey', 'Turkiye'],
  CZ: ['Czech Republic'],
  TL: ['East Timor'],
  CI: ["Côte d'Ivoire", 'Cote d’Ivoire'],
  CV: ['Cabo Verde'],
  SZ: ['Swaziland'],
  MK: ['Macedonia'],
  MM: ['Burma'],
  KR: ['Korea', 'Republic of Korea'],
  CD: ['DRC', 'Congo-Kinshasa', 'Congo'],
  CG: ['Congo-Brazzaville', 'Congo'],
  RU: ['Russian Federation'],
  IR: ['Persia'],
  VA: ['Vatican'],
  BQ: ['Bonaire'],
};

/** Lower case, no accents, so "reunion" finds Réunion. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const COUNTRY_CODE_BY_NAME: Record<string, string> = {};
for (const country of COUNTRIES) {
  for (const name of [country.name, ...(ALIASES[country.code] ?? [])]) {
    COUNTRY_CODE_BY_NAME[normalize(name)] ??= country.code;
  }
}

export function countryCodeForName(name: string): string | undefined {
  return COUNTRY_CODE_BY_NAME[normalize(name)];
}

/** The airport's ISO country code: from the fare data when it has one, else from its country name. */
export function countryCodeOf(airport: Pick<AirportInfo, 'country' | 'country_code'>): string | undefined {
  return airport.country_code || countryCodeForName(airport.country);
}

/** The region keys an airport falls in: its subregion and its continent. */
export function regionsOfCountry(code: string | undefined): string[] {
  const country = code ? COUNTRY_BY_CODE[code] : undefined;
  return country ? [country.subregion, country.continent] : [];
}

/**
 * Countries matching what the user typed: an exact name or alias ("UK"), then the code,
 * then names (or aliases)
 * that start with it, then names with a word that starts with it.
 */
export function searchCountries(text: string): Country[] {
  const needle = normalize(text);
  if (!needle) return COUNTRIES;
  const scored: [Country, number][] = [];
  for (const country of COUNTRIES) {
    const names = [country.name, ...(ALIASES[country.code] ?? [])].map(normalize);
    let score = 0;
    if (names.includes(needle)) score = 4;
    else if (needle.length === 2 && country.code.toLowerCase() === needle) score = 3;
    else if (names.some(n => n.startsWith(needle))) score = 2;
    else if (names.some(n => n.split(/[\s\-(),.]+/).some(word => word.startsWith(needle)))) score = 1;
    if (score) scored.push([country, score]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'en')).map(([c]) => c);
}

/**
 * Tidies a region selection: a continent whose subregions are all picked becomes
 * the continent, and subregions of a picked continent are dropped.
 */
export function normalizeRegions(keys: string[]): string[] {
  const picked = new Set(keys.filter(k => k in REGION_BY_KEY));
  for (const continent of CONTINENTS) {
    const subs = SUBREGIONS_OF[continent.key];
    if (subs.every(s => picked.has(s))) picked.add(continent.key);
    if (picked.has(continent.key)) subs.forEach(s => picked.delete(s));
  }
  return [...CONTINENTS, ...SUBREGIONS].map(r => r.key).filter(k => picked.has(k));
}

/** Toggles one region in a selection, splitting a picked continent when one of its subregions is unticked. */
export function toggleRegion(selected: string[], key: string): string[] {
  const region = REGION_BY_KEY[key];
  if (!region) return selected;
  const set = new Set(selected);
  if (region.parent && set.has(region.parent)) {
    set.delete(region.parent);
    for (const sub of SUBREGIONS_OF[region.parent]) if (sub !== key) set.add(sub);
  } else if (set.has(key)) set.delete(key);
  else set.add(key);
  return normalizeRegions([...set]);
}

/** True when a region is picked directly or through its continent. */
export function isRegionSelected(selected: string[], key: string): boolean {
  const parent = REGION_BY_KEY[key]?.parent;
  return selected.includes(key) || (!!parent && selected.includes(parent));
}

/** "Spain", "Spain and Portugal", "Spain + 3 more". */
export function summarizeNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} + ${names.length - 1} more`;
}
