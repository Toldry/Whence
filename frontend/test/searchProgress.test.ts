import { describe, expect, it } from 'vitest';
import { searchAcrossMonths } from '../src/api/acrossMonths';
import type { FareSource, InboundQuery, InboundResponse } from '../src/api/types';
import { progressFraction, stageText } from '../src/components/SearchProgress';

describe('progressFraction', () => {
  it('starts empty, keeps moving, never claims done before every month answers', () => {
    expect(progressFraction(0, 2, 0)).toBe(0);
    expect(progressFraction(0, 2, 5_000)).toBeGreaterThan(0.3);
    expect(progressFraction(0, 2, 600_000)).toBeLessThan(0.91);
    expect(progressFraction(1, 2, 600_000)).toBeLessThan(0.96);
    expect(progressFraction(2, 2, 1_000)).toBe(1);
  });

  it('only grows as time passes and months answer', () => {
    let previous = 0;
    for (const [done, elapsed] of [[0, 0], [0, 2_000], [1, 2_000], [1, 9_000], [2, 9_000]]) {
      const fraction = progressFraction(done, 2, elapsed);
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
  });
});

describe('stageText', () => {
  it('moves on from the first stage and warns before the timeout', () => {
    expect(stageText(1_000, true)).toMatch(/every airport/);
    expect(stageText(6_000, true)).toMatch(/hubs/);
    expect(stageText(6_000, false)).not.toMatch(/hubs/);
    expect(stageText(30_000, false)).toMatch(/stop waiting/);
  });
});

describe('searchAcrossMonths progress', () => {
  it('reports each month as it answers', async () => {
    const empty = (month: string): InboundResponse => ({ destination: 'GUA', currency: 'EUR', fares: [], airports: {}, month } as never);
    const source: FareSource = {
      searchInbound: async query => empty(query.month),
      searchPlaces: async () => [],
    };
    const query = {
      destination: 'GUA', trip: 'oneway', dateMode: 'flex', month: '2026-11', monthTo: '2026-12',
      flexKind: 'week', length: 7, depart: '', returnDate: '', departFrom: '2026-11-22', departTo: '2026-12-13',
    } as InboundQuery;
    const reports: string[] = [];
    await searchAcrossMonths(source, query, undefined, (done, total) => reports.push(`${done}/${total}`));
    expect(reports).toEqual(['0/2', '1/2', '2/2']);
  });
});
