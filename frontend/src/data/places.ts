/**
 * Static place data the UI needs before any search: destinations for the "To" field,
 * home cities for the ground-transport estimate, and how countries group into regions.
 * Origin airports come from the fare source's `airports` map, so this list is only a
 * fallback and the mock's seed data.
 */
import type { AirportInfo } from '../api/types';

export interface Destination {
  iata: string;
  city: string;
  country: string;
  airport: string;
  lat: number;
  lon: number;
}

export interface HomeCity {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export const REGIONS: Record<string, string> = {
  europe: 'Europe',
  iberia: 'Iberia',
  british: 'British Isles',
  western: 'Western Europe',
  central: 'Central Europe',
  nordic: 'Nordics',
  southern: 'Southern Europe',
  na: 'North America',
};

const REGION_BY_COUNTRY: Record<string, string> = {
  Spain: 'iberia', Portugal: 'iberia',
  'United Kingdom': 'british', Ireland: 'british',
  France: 'western', Belgium: 'western', Netherlands: 'western', Luxembourg: 'western',
  Switzerland: 'central', Germany: 'central', Austria: 'central', Czechia: 'central',
  Poland: 'central', Hungary: 'central', Slovakia: 'central',
  Denmark: 'nordic', Sweden: 'nordic', Norway: 'nordic', Finland: 'nordic', Iceland: 'nordic',
  Italy: 'southern', Greece: 'southern', 'Türkiye': 'southern', Malta: 'southern', Croatia: 'southern',
  'United States': 'na', Canada: 'na',
};

export function regionOfCountry(country: string): string | undefined {
  return REGION_BY_COUNTRY[country];
}

export function isNorthAmerica(country: string): boolean {
  return REGION_BY_COUNTRY[country] === 'na';
}

const airport = (
  iata: string, city: string, country: string, lat: number, lon: number, name?: string,
): AirportInfo => ({ iata, city, country, lat, lon, name: name ?? city });

/** Origins the mock fare source knows about. */
export const MOCK_AIRPORTS: AirportInfo[] = [
  airport('MAD', 'Madrid', 'Spain', 40.472, -3.561, 'Madrid–Barajas'),
  airport('BCN', 'Barcelona', 'Spain', 41.297, 2.078, 'Barcelona–El Prat'),
  airport('OPO', 'Porto', 'Portugal', 41.248, -8.681, 'Francisco Sá Carneiro'),
  airport('FNC', 'Funchal', 'Portugal', 32.694, -16.778, 'Madeira'),
  airport('PDL', 'Ponta Delgada', 'Portugal', 37.742, -25.698, 'João Paulo II'),
  airport('LGW', 'London', 'United Kingdom', 51.148, -0.19, 'Gatwick'),
  airport('MAN', 'Manchester', 'United Kingdom', 53.354, -2.275),
  airport('EDI', 'Edinburgh', 'United Kingdom', 55.95, -3.373),
  airport('DUB', 'Dublin', 'Ireland', 53.421, -6.27),
  airport('ORY', 'Paris', 'France', 48.723, 2.379, 'Orly'),
  airport('LYS', 'Lyon', 'France', 45.726, 5.091, 'Saint-Exupéry'),
  airport('NCE', 'Nice', 'France', 43.658, 7.216, 'Côte d’Azur'),
  airport('GVA', 'Geneva', 'Switzerland', 46.238, 6.109),
  airport('BRU', 'Brussels', 'Belgium', 50.901, 4.484),
  airport('AMS', 'Amsterdam', 'Netherlands', 52.31, 4.768, 'Schiphol'),
  airport('ZRH', 'Zurich', 'Switzerland', 47.458, 8.555),
  airport('FRA', 'Frankfurt', 'Germany', 50.038, 8.562),
  airport('MUC', 'Munich', 'Germany', 48.354, 11.786),
  airport('BER', 'Berlin', 'Germany', 52.366, 13.503, 'Brandenburg'),
  airport('VIE', 'Vienna', 'Austria', 48.11, 16.57),
  airport('PRG', 'Prague', 'Czechia', 50.101, 14.26),
  airport('WAW', 'Warsaw', 'Poland', 52.166, 20.967, 'Chopin'),
  airport('KRK', 'Kraków', 'Poland', 50.078, 19.785),
  airport('BUD', 'Budapest', 'Hungary', 47.437, 19.256),
  airport('CPH', 'Copenhagen', 'Denmark', 55.618, 12.656),
  airport('ARN', 'Stockholm', 'Sweden', 59.65, 17.919, 'Arlanda'),
  airport('OSL', 'Oslo', 'Norway', 60.194, 11.1, 'Gardermoen'),
  airport('HEL', 'Helsinki', 'Finland', 60.317, 24.963, 'Helsinki-Vantaa'),
  airport('FCO', 'Rome', 'Italy', 41.8, 12.239, 'Fiumicino'),
  airport('MXP', 'Milan', 'Italy', 45.63, 8.723, 'Malpensa'),
  airport('ATH', 'Athens', 'Greece', 37.936, 23.947),
  airport('IST', 'Istanbul', 'Türkiye', 41.262, 28.742),
  airport('JFK', 'New York', 'United States', 40.641, -73.778, 'JFK'),
  airport('BOS', 'Boston', 'United States', 42.366, -71.01, 'Logan'),
  airport('IAD', 'Washington', 'United States', 38.953, -77.456, 'Dulles'),
  airport('MIA', 'Miami', 'United States', 25.796, -80.287),
  airport('ORD', 'Chicago', 'United States', 41.974, -87.907, "O'Hare"),
  airport('SFO', 'San Francisco', 'United States', 37.621, -122.379),
  airport('LAX', 'Los Angeles', 'United States', 33.942, -118.408),
  airport('YYZ', 'Toronto', 'Canada', 43.677, -79.624, 'Pearson'),
  airport('YUL', 'Montréal', 'Canada', 45.47, -73.741, 'Trudeau'),
];

export const DESTINATIONS: Destination[] = [
  { iata: 'LIS', city: 'Lisbon', country: 'Portugal', airport: 'Humberto Delgado', lat: 38.774, lon: -9.134 },
  { iata: 'OPO', city: 'Porto', country: 'Portugal', airport: 'Francisco Sá Carneiro', lat: 41.248, lon: -8.681 },
  { iata: 'FAO', city: 'Faro', country: 'Portugal', airport: 'Faro', lat: 37.017, lon: -7.966 },
  { iata: 'FNC', city: 'Funchal', country: 'Portugal', airport: 'Madeira', lat: 32.694, lon: -16.778 },
  { iata: 'MAD', city: 'Madrid', country: 'Spain', airport: 'Madrid–Barajas', lat: 40.472, lon: -3.561 },
  { iata: 'BCN', city: 'Barcelona', country: 'Spain', airport: 'Barcelona–El Prat', lat: 41.297, lon: 2.078 },
  { iata: 'SVQ', city: 'Seville', country: 'Spain', airport: 'Seville', lat: 37.418, lon: -5.893 },
  { iata: 'FCO', city: 'Rome', country: 'Italy', airport: 'Fiumicino', lat: 41.8, lon: 12.239 },
  { iata: 'ATH', city: 'Athens', country: 'Greece', airport: 'Athens International', lat: 37.936, lon: 23.947 },
  { iata: 'DUB', city: 'Dublin', country: 'Ireland', airport: 'Dublin', lat: 53.421, lon: -6.27 },
  { iata: 'KEF', city: 'Reykjavík', country: 'Iceland', airport: 'Keflavík', lat: 63.985, lon: -22.605 },
  { iata: 'IST', city: 'Istanbul', country: 'Türkiye', airport: 'Istanbul', lat: 41.262, lon: 28.742 },
];
export const DESTINATION_BY_IATA = Object.fromEntries(DESTINATIONS.map(d => [d.iata, d]));

const home = (name: string, country: string, lat: number, lon: number): HomeCity => ({ name, country, lat, lon });
export const HOMES: HomeCity[] = [
  home('Amsterdam', 'Netherlands', 52.37, 4.895), home('Barcelona', 'Spain', 41.387, 2.17),
  home('Basel', 'Switzerland', 47.56, 7.59), home('Berlin', 'Germany', 52.52, 13.405),
  home('Bordeaux', 'France', 44.838, -0.579), home('Bristol', 'United Kingdom', 51.455, -2.588),
  home('Brussels', 'Belgium', 50.85, 4.352), home('Cologne', 'Germany', 50.938, 6.96),
  home('Dublin', 'Ireland', 53.35, -6.26), home('Frankfurt', 'Germany', 50.11, 8.682),
  home('Hamburg', 'Germany', 53.551, 9.994), home('London', 'United Kingdom', 51.507, -0.128),
  home('Lyon', 'France', 45.764, 4.836), home('Madrid', 'Spain', 40.417, -3.704),
  home('Manchester', 'United Kingdom', 53.481, -2.243), home('Marseille', 'France', 43.296, 5.37),
  home('Milan', 'Italy', 45.464, 9.19), home('Munich', 'Germany', 48.137, 11.576),
  home('Paris', 'France', 48.857, 2.352), home('Prague', 'Czechia', 50.075, 14.438),
  home('Rotterdam', 'Netherlands', 51.924, 4.478), home('Seville', 'Spain', 37.389, -5.984),
  home('Strasbourg', 'France', 48.573, 7.752), home('Toulouse', 'France', 43.605, 1.444),
  home('Turin', 'Italy', 45.07, 7.687), home('Valencia', 'Spain', 39.47, -0.376),
  home('Vienna', 'Austria', 48.208, 16.373), home('Zurich', 'Switzerland', 47.377, 8.54),
];
export const HOME_BY_NAME = Object.fromEntries(HOMES.map(h => [h.name, h]));
