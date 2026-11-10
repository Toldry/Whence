import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairSelfTransfers, type LegRow } from '../src/providers/self-transfer.ts';

const window = { minConnectionMinutes: 120, maxConnectionMinutes: 24 * 60 };
const leg = (from: string, to: string, departs: string, minutes: number, price: number, transfers = 0): LegRow => ({
  origin: from, destination: to, origin_airport: from, destination_airport: to,
  departure_at: departs, duration_to: minutes, price, transfers,
});
// Madrid -> Guatemala City, 16:20 Madrid time.
const onward = [leg('MAD', 'GUA', '2026-11-25T16:20:00+01:00', 715, 1097)];

test('pairs a feeder that lands at least two hours before the onward flight', () => {
  // Rome 06:00 +01:00, 160 min, lands 08:40; 7 h 40 min to connect.
  const trips = pairSelfTransfers([leg('FCO', 'MAD', '2026-11-25T06:00:00+01:00', 160, 41)], onward, window);
  assert.equal(trips.length, 1);
  assert.deepEqual(
    { origin: trips[0]!.origin, via: trips[0]!.via, price: trips[0]!.price, layover: trips[0]!.layoverMinutes },
    { origin: 'FCO', via: 'MAD', price: 1138, layover: 460 });
  assert.equal(trips[0]!.durationMinutes, 160 + 460 + 715);
});

test('compares times across time zones', () => {
  // Bucharest 12:00 +02:00 is 11:00 Madrid time; 240 min lands 15:00, 80 min to connect.
  const trips = pairSelfTransfers([leg('OTP', 'MAD', '2026-11-25T12:00:00+02:00', 240, 58)], onward, window);
  assert.equal(trips.length, 0);
});

test('rejects connections outside the window, stops and other hub airports', () => {
  const feeders = [
    leg('CPH', 'MAD', '2026-11-25T12:00:00+01:00', 205, 50), // lands 15:25, 55 min
    leg('PRG', 'MAD', '2026-11-23T10:00:00+01:00', 180, 50), // over a day early
    leg('ATH', 'MAD', '2026-11-25T06:00:00+01:00', 240, 50, 1), // has a stop itself
    { ...leg('LIS', 'BCN', '2026-11-25T06:00:00+00:00', 120, 50), destination: 'MAD' }, // wrong airport
  ];
  assert.equal(pairSelfTransfers(feeders, onward, window).length, 0);
});

test('keeps the cheapest pairing per origin', () => {
  const twoOnward = [...onward, leg('MAD', 'GUA', '2026-11-25T23:50:00+01:00', 715, 900)];
  const trips = pairSelfTransfers([leg('FCO', 'MAD', '2026-11-25T06:00:00+01:00', 160, 41)], twoOnward, window);
  assert.equal(trips.length, 1);
  assert.equal(trips[0]!.price, 941);
});
