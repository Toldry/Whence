import type { SelfTransferLeg } from '../types.ts';

/**
 * Self-transfer connections: two separately cached nonstop fares joined at a hub,
 * e.g. Rome -> Madrid on one ticket, then Madrid -> Guatemala City on another.
 *
 * The Travelpayouts cache only holds itineraries someone searched end to end, so a
 * city that flies nonstop to a hub with a nonstop to the destination often has no
 * cached 1-stop fare of its own. Pairing the legs fills that gap. Such trips are
 * on separate tickets: no airline protects the connection.
 */

/** The upstream row fields pairing needs (a prices_for_dates row). */
export interface LegRow {
  origin: string;
  destination: string;
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline?: string;
  /** Local departure time with offset, e.g. 2026-11-25T16:20:00+01:00. */
  departure_at: string;
  duration?: number;
  duration_to?: number;
  transfers?: number;
  link?: string;
}

export interface PairingOptions {
  /** Shortest time between landing and the next departure. */
  minConnectionMinutes: number;
  /** Longest time between landing and the next departure. */
  maxConnectionMinutes: number;
}

export interface PairedTrip {
  origin: string;
  via: string;
  price: number;
  /** Local departure date of the first leg, YYYY-MM-DD. */
  departDate: string;
  layoverMinutes: number;
  /** From the first departure to the second arrival. */
  durationMinutes: number;
  first: LegRow;
  second: LegRow;
}

const MINUTE_MS = 60_000;

const airportOf = (code: string | undefined, fallback: string) => code || fallback;
const legMinutes = (row: LegRow) => row.duration_to ?? row.duration ?? null;

/**
 * Joins nonstop legs into a hub with nonstop legs out of it, keeping the cheapest
 * pairing per origin airport. Both legs must use the same hub airport, and the
 * connection must fall within the window.
 */
export function pairSelfTransfers(
  feeders: LegRow[], onward: LegRow[], options: PairingOptions,
): PairedTrip[] {
  const onwardByAirport = new Map<string, { row: LegRow; departs: number; minutes: number }[]>();
  for (const row of onward) {
    if ((row.transfers ?? 0) !== 0) continue;
    const minutes = legMinutes(row);
    const departs = Date.parse(row.departure_at);
    if (minutes === null || Number.isNaN(departs)) continue;
    const hub = airportOf(row.origin_airport, row.origin);
    const list = onwardByAirport.get(hub) ?? [];
    list.push({ row, departs, minutes });
    onwardByAirport.set(hub, list);
  }

  const best = new Map<string, PairedTrip>();
  for (const feeder of feeders) {
    if ((feeder.transfers ?? 0) !== 0) continue;
    const minutes = legMinutes(feeder);
    const departs = Date.parse(feeder.departure_at);
    if (minutes === null || Number.isNaN(departs)) continue;
    const hub = airportOf(feeder.destination_airport, feeder.destination);
    const origin = airportOf(feeder.origin_airport, feeder.origin);
    const lands = departs + minutes * MINUTE_MS;
    for (const next of onwardByAirport.get(hub) ?? []) {
      const destination = airportOf(next.row.destination_airport, next.row.destination);
      if (origin === destination) continue;
      const layoverMinutes = Math.round((next.departs - lands) / MINUTE_MS);
      if (layoverMinutes < options.minConnectionMinutes || layoverMinutes > options.maxConnectionMinutes) continue;
      const price = feeder.price + next.row.price;
      const previous = best.get(origin);
      if (previous && previous.price <= price) continue;
      best.set(origin, {
        origin, via: hub, price, departDate: feeder.departure_at.slice(0, 10), layoverMinutes,
        durationMinutes: Math.round((next.departs + next.minutes * MINUTE_MS - departs) / MINUTE_MS),
        first: feeder, second: next.row,
      });
    }
  }
  return [...best.values()];
}

/** A leg as the API returns it. */
export function toLeg(row: LegRow, airlineName: (code: string) => string, link: string): SelfTransferLeg {
  return {
    origin: airportOf(row.origin_airport, row.origin),
    destination: airportOf(row.destination_airport, row.destination),
    departure_at: row.departure_at,
    duration_minutes: legMinutes(row),
    price: Math.round(row.price),
    airlines: row.airline ? [airlineName(row.airline)] : [],
    link,
  };
}
