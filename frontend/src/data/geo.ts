/** Distance, flight-time and ground-transport estimates. All distances in km. */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Place extends LatLon {
  country: string;
  iata?: string;
}

export type GroundMode = 'transfer' | 'bus' | 'train' | 'flight';

export interface GroundEstimate {
  mode: GroundMode;
  /** One way, per adult, EUR. */
  cost: number;
  minutes: number;
  km: number;
}

const EARTH_RADIUS_KM = 6371;

export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Rough block time: 30 min overhead + 800 km/h, plus a connection penalty. */
export function estimateFlightMinutes(km: number, transfers: number): number {
  const direct = 30 + (km / 800) * 60;
  return Math.round((transfers ? direct * 1.3 + 100 : direct) / 5) * 5;
}

type Landmass = 'gb' | 'ie' | 'na' | 'eu' | 'island';
const ISLAND_AIRPORTS = new Set(['FNC', 'PDL', 'PMI', 'IBZ', 'TFS', 'LPA', 'ACE', 'FUE', 'KEF']);
const NORTH_AMERICA = new Set(['United States', 'Canada', 'Mexico']);

function landmassOf(place: Place): Landmass {
  if (place.iata && ISLAND_AIRPORTS.has(place.iata)) return 'island';
  if (place.country === 'United Kingdom') return 'gb';
  if (place.country === 'Ireland') return 'ie';
  if (NORTH_AMERICA.has(place.country)) return 'na';
  return 'eu';
}

/** Cheapest usual way from a home city to an airport, one way, per adult. */
export function estimateGround(home: Place, airport: Place): GroundEstimate {
  const roadKm = distanceKm(home, airport) * 1.2;
  const homeLand = landmassOf(home);
  const airportLand = landmassOf(airport);
  const viaChannelTunnel = (homeLand === 'gb' && airportLand === 'eu') || (homeLand === 'eu' && airportLand === 'gb');
  const reachableOverland = (homeLand === airportLand && homeLand !== 'island') || (viaChannelTunnel && roadKm < 800);
  const km = Math.round(roadKm);

  if (roadKm < 45) return { mode: 'transfer', cost: 9, minutes: 50, km };
  if (reachableOverland && roadKm < 220 && !viaChannelTunnel) {
    return { mode: 'bus', cost: Math.round(6 + roadKm * 0.07), minutes: Math.round((roadKm / 65) * 60 + 25), km };
  }
  if (reachableOverland && roadKm < 1150) {
    return {
      mode: 'train',
      cost: Math.round(14 + roadKm * 0.105 + (viaChannelTunnel ? 30 : 0)),
      minutes: Math.round((roadKm / 115) * 60 + 45),
      km,
    };
  }
  if (homeLand === 'na' || airportLand === 'na') {
    return { mode: 'flight', cost: Math.round(290 + roadKm * 0.035), minutes: Math.round((roadKm / 800) * 60 + 200), km };
  }
  return { mode: 'flight', cost: Math.round(48 + roadKm * 0.045), minutes: Math.round((roadKm / 750) * 60 + 150), km };
}
