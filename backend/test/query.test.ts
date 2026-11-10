import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitsTripShape, parseInboundQuery, queryCacheKey } from '../src/query.ts';
import type { InboundQuery } from '../src/types.ts';

const parse = (qs: string) => parseInboundQuery(new URLSearchParams(qs));

test('parses a flexible weekend search with defaults', () => {
  const result = parse('destination=lis&month=2027-03');
  assert.deepEqual(result, {
    ok: true,
    query: { destination: 'LIS', trip: 'round', dateMode: 'flex', month: '2027-03', flexKind: 'weekend' },
  });
});

test('rejects bad parameters with a readable message', () => {
  for (const qs of [
    'destination=LISBON&month=2027-03',
    'destination=LIS&month=2027-13',
    'destination=LIS&month=2027-03&flex_kind=custom',
    'destination=LIS&month=2027-03&flex_kind=custom&length=40',
    'destination=LIS&date_mode=exact&depart=2027-02-30&return=2027-03-02',
    'destination=LIS&date_mode=exact&depart=2027-03-12&return=2027-03-10',
    'destination=LIS&trip=multi&month=2027-03',
  ]) {
    const result = parse(qs);
    assert.equal(result.ok, false, qs);
  }
});

test('exact one-way ignores the return date', () => {
  const result = parse('destination=LIS&trip=oneway&date_mode=exact&depart=2027-03-12&return=2027-03-15');
  assert.ok(result.ok);
  assert.equal(result.query.return, undefined);
});

test('cache key differs when any search input differs', () => {
  const base: InboundQuery = { destination: 'LIS', trip: 'round', dateMode: 'flex', month: '2027-03', flexKind: 'weekend' };
  assert.notEqual(queryCacheKey(base), queryCacheKey({ ...base, month: '2027-04' }));
  assert.equal(queryCacheKey(base), queryCacheKey({ ...base }));
});

const today = '2026-11-10';
const weekend: InboundQuery = { destination: 'LIS', trip: 'round', dateMode: 'flex', month: '2027-03', flexKind: 'weekend' };

test('weekend shape accepts Fri to Sun, rejects midweek and other months', () => {
  assert.ok(fitsTripShape(weekend, '2027-03-12', '2027-03-14', today)); // Fri -> Sun
  assert.ok(fitsTripShape(weekend, '2027-03-13', '2027-03-15', today)); // Sat -> Mon
  assert.ok(!fitsTripShape(weekend, '2027-03-09', '2027-03-11', today)); // Tue -> Thu
  assert.ok(!fitsTripShape(weekend, '2027-03-12', '2027-03-21', today)); // too long
  assert.ok(!fitsTripShape(weekend, '2027-04-02', '2027-04-04', today)); // wrong month
  assert.ok(!fitsTripShape(weekend, '2027-03-12', null, today)); // round trip needs a return
});

test('week and custom lengths allow a one-day tolerance', () => {
  const week = { ...weekend, flexKind: 'week' as const };
  assert.ok(fitsTripShape(week, '2027-03-06', '2027-03-13', today));
  assert.ok(!fitsTripShape(week, '2027-03-06', '2027-03-09', today));
  const custom = { ...weekend, flexKind: 'custom' as const, length: 5 };
  assert.ok(fitsTripShape(custom, '2027-03-02', '2027-03-08', today)); // 6 days
  assert.ok(!fitsTripShape(custom, '2027-03-02', '2027-03-10', today)); // 8 days
});

test('exact dates must match, and past departures are dropped', () => {
  const exact: InboundQuery = { destination: 'LIS', trip: 'round', dateMode: 'exact', depart: '2027-03-12', return: '2027-03-15' };
  assert.ok(fitsTripShape(exact, '2027-03-12', '2027-03-15', today));
  assert.ok(!fitsTripShape(exact, '2027-03-12', '2027-03-16', today));
  const past = { ...weekend, month: '2026-11' };
  assert.ok(!fitsTripShape(past, '2026-11-06', '2026-11-08', today));
});

test('parses an optional departure window inside the month', () => {
  const result = parse('destination=LIS&month=2027-03&depart_from=2027-03-12&depart_to=2027-03-23');
  assert.ok(result.ok);
  assert.equal(result.query.departFrom, '2027-03-12');
  assert.equal(result.query.departTo, '2027-03-23');
  for (const qs of [
    'destination=LIS&month=2027-03&depart_from=2027-04-01',
    'destination=LIS&month=2027-03&depart_to=2027-03-32',
    'destination=LIS&month=2027-03&depart_from=2027-03-20&depart_to=2027-03-10',
  ]) assert.equal(parse(qs).ok, false, qs);
});

test('the departure window narrows flexible fares and the cache key', () => {
  const narrowed = { ...weekend, departFrom: '2027-03-10', departTo: '2027-03-20' };
  assert.ok(fitsTripShape(narrowed, '2027-03-12', '2027-03-14', today));
  assert.ok(!fitsTripShape(narrowed, '2027-03-05', '2027-03-07', today));
  assert.ok(!fitsTripShape(narrowed, '2027-03-26', '2027-03-28', today));
  assert.notEqual(queryCacheKey(weekend), queryCacheKey(narrowed));
});
