import { describe, expect, it } from 'vitest';
import {
    bucketStart,
    buildSeries,
    formatBucketLong,
    formatBucketShort,
    nextBucket,
    parseDay,
    totalCount,
} from './growthSeries';

// Wednesday 2026-09-23 12:00 UTC
const NOW = Date.UTC(2026, 8, 23, 12);

describe('bucketStart / nextBucket', () => {
    it('day buckets are UTC midnight', () => {
        expect(bucketStart(NOW, 'day')).toBe(Date.UTC(2026, 8, 23));
        expect(nextBucket(Date.UTC(2026, 8, 23), 'day')).toBe(Date.UTC(2026, 8, 24));
    });

    it('weeks start on Monday', () => {
        expect(bucketStart(NOW, 'week')).toBe(Date.UTC(2026, 8, 21));
        // Sunday belongs to the week that started the previous Monday
        expect(bucketStart(Date.UTC(2026, 8, 27), 'week')).toBe(Date.UTC(2026, 8, 21));
        // Monday is its own week start
        expect(bucketStart(Date.UTC(2026, 8, 21), 'week')).toBe(Date.UTC(2026, 8, 21));
        expect(nextBucket(Date.UTC(2026, 8, 21), 'week')).toBe(Date.UTC(2026, 8, 28));
    });

    it('months start on the 1st and roll over the year', () => {
        expect(bucketStart(NOW, 'month')).toBe(Date.UTC(2026, 8, 1));
        expect(nextBucket(Date.UTC(2026, 11, 1), 'month')).toBe(Date.UTC(2027, 0, 1));
    });
});

describe('buildSeries', () => {
    const rows = [
        { day: '2026-09-14', count: 2 }, // Mon, week of Sep 14
        { day: '2026-09-16', count: 1 }, // Wed, same week
        { day: '2026-09-22', count: 5 }, // Tue, week of Sep 21
    ];

    it('is empty with no rows', () => {
        expect(buildSeries([], { bucket: 'day', mode: 'rate', range: 'all', now: NOW })).toEqual([]);
    });

    it('fills every day from the first row through today with zeros', () => {
        const series = buildSeries(rows, { bucket: 'day', mode: 'rate', range: 'all', now: NOW });
        expect(series).toHaveLength(10); // Sep 14 .. Sep 23
        expect(series[0]).toEqual({ start: parseDay('2026-09-14'), value: 2 });
        expect(series[1]).toEqual({ start: parseDay('2026-09-15'), value: 0 });
        expect(series[8]).toEqual({ start: parseDay('2026-09-22'), value: 5 });
        expect(series[9]).toEqual({ start: parseDay('2026-09-23'), value: 0 });
    });

    it('sums rows into weekly buckets', () => {
        const series = buildSeries(rows, { bucket: 'week', mode: 'rate', range: 'all', now: NOW });
        expect(series).toEqual([
            { start: Date.UTC(2026, 8, 14), value: 3 },
            { start: Date.UTC(2026, 8, 21), value: 5 },
        ]);
    });

    it('cumulative is a running total', () => {
        const series = buildSeries(rows, { bucket: 'week', mode: 'cumulative', range: 'all', now: NOW });
        expect(series.map(p => p.value)).toEqual([3, 8]);
    });

    it('a range keeps the running total from before the window', () => {
        const old = [{ day: '2025-01-01', count: 100 }, ...rows];
        const series = buildSeries(old, { bucket: 'week', mode: 'cumulative', range: '30d', now: NOW });
        // 30 days before Sep 23 is Aug 24 (a Monday) — 5 weeks through Sep 21
        expect(series).toHaveLength(5);
        expect(series[0]).toEqual({ start: Date.UTC(2026, 7, 24), value: 100 });
        expect(series[series.length - 1]).toEqual({ start: Date.UTC(2026, 8, 21), value: 108 });
    });

    it('a range longer than the history pads the lead-in with zeros', () => {
        const series = buildSeries(rows, { bucket: 'week', mode: 'rate', range: '30d', now: NOW });
        expect(series.map(p => p.value)).toEqual([0, 0, 0, 3, 5]);
        expect(series[0].start).toBe(Date.UTC(2026, 7, 24));
    });
});

describe('labels', () => {
    it('formats each bucket for axis and tooltip', () => {
        const monday = Date.UTC(2026, 8, 21);
        expect(formatBucketShort(monday, 'day')).toBe('Sep 21');
        expect(formatBucketShort(monday, 'week')).toBe('Sep 21');
        expect(formatBucketShort(Date.UTC(2026, 8, 1), 'month')).toBe('Sep 2026');
        expect(formatBucketLong(monday, 'day')).toBe('Sep 21, 2026');
        expect(formatBucketLong(monday, 'week')).toBe('Week of Sep 21, 2026');
        expect(formatBucketLong(Date.UTC(2026, 8, 1), 'month')).toBe('September 2026');
    });

    it('totals every row', () => {
        expect(totalCount([{ day: '2026-01-01', count: 2 }, { day: '2026-01-02', count: 3 }])).toBe(5);
    });
});
