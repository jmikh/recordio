/**
 * Turns the sparse per-day counts from /admin-growth-stats into the
 * dense series the growth charts draw. Pure — all the dashboard's
 * switches (day/week/month, rate/cumulative, range) are computed here
 * from one fetch, no refetch.
 *
 * Every date is handled in UTC, matching the server's UTC day buckets:
 * a "week" starts Monday 00:00 UTC, a "month" on the 1st 00:00 UTC.
 */
import type { AdminDailyCount } from '@shared/api';

export type Bucket = 'day' | 'week' | 'month';
export type Mode = 'rate' | 'cumulative';
export type Range = '30d' | '90d' | '1y' | 'all';

export interface SeriesPoint {
    /** Bucket start — UTC midnight, ms since epoch. */
    start: number;
    /** Rows created in the bucket (rate) or ever, through the bucket (cumulative). */
    value: number;
}

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '30d': 30, '90d': 90, '1y': 365 };

/** 'YYYY-MM-DD' → UTC midnight ms. */
export function parseDay(day: string): number {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

/** UTC midnight of the bucket containing `ms`. */
export function bucketStart(ms: number, bucket: Bucket): number {
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    switch (bucket) {
        case 'day':
            return Date.UTC(y, m, d);
        case 'week': {
            // Monday-start: Sunday (0) is 6 days into its week
            const sinceMonday = (date.getUTCDay() + 6) % 7;
            return Date.UTC(y, m, d - sinceMonday);
        }
        case 'month':
            return Date.UTC(y, m, 1);
    }
}

/** Start of the bucket after the one starting at `start`. */
export function nextBucket(start: number, bucket: Bucket): number {
    const date = new Date(start);
    switch (bucket) {
        case 'day':
            return start + DAY_MS;
        case 'week':
            return start + 7 * DAY_MS;
        case 'month':
            return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    }
}

export interface BuildSeriesOptions {
    bucket: Bucket;
    mode: Mode;
    range: Range;
    /** "Today" — the series always runs through the bucket containing it. */
    now: number;
}

/**
 * Dense series, one point per bucket, ascending. Runs from the first
 * row (or the range start, whichever is earlier, so a short history
 * still shows its empty lead-in) through today's bucket.
 *
 * Cumulative totals are computed over the WHOLE history before the
 * range is applied — a 30-day view of a running total still starts
 * from the true count on that day, not from zero.
 */
export function buildSeries(rows: AdminDailyCount[], opts: BuildSeriesOptions): SeriesPoint[] {
    const { bucket, mode, range, now } = opts;
    if (rows.length === 0) return [];

    const sums = new Map<number, number>();
    let firstDay = Infinity;
    for (const row of rows) {
        const day = parseDay(row.day);
        if (day < firstDay) firstDay = day;
        const key = bucketStart(day, bucket);
        sums.set(key, (sums.get(key) ?? 0) + row.count);
    }

    const rangeStart = range === 'all'
        ? null
        : bucketStart(now - RANGE_DAYS[range] * DAY_MS, bucket);
    const denseStart = bucketStart(firstDay, bucket);
    const end = bucketStart(now, bucket);

    const points: SeriesPoint[] = [];
    let running = 0;
    for (let start = denseStart; start <= end; start = nextBucket(start, bucket)) {
        const count = sums.get(start) ?? 0;
        running += count;
        points.push({ start, value: mode === 'cumulative' ? running : count });
    }

    if (rangeStart === null) return points;

    const inRange = points.filter(p => p.start >= rangeStart);
    // A history shorter than the range: pad the empty lead-in (zero in
    // both modes — nothing existed yet) so the x-axis still spans the
    // requested window
    const padding: SeriesPoint[] = [];
    for (let start = rangeStart; start < denseStart; start = nextBucket(start, bucket)) {
        padding.push({ start, value: 0 });
    }
    return [...padding, ...inRange];
}

/** Sum of every row — the "total to date" figure above a chart. */
export function totalCount(rows: AdminDailyCount[]): number {
    return rows.reduce((sum, r) => sum + r.count, 0);
}

const SHORT_DAY: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'short', day: 'numeric' };
const LONG_DAY: Intl.DateTimeFormatOptions = { ...SHORT_DAY, year: 'numeric' };
const SHORT_MONTH: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'short', year: 'numeric' };
const LONG_MONTH: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'long', year: 'numeric' };

/** Axis tick text: "Sep 23" / "Sep 21" (week start) / "Sep 2026". */
export function formatBucketShort(start: number, bucket: Bucket): string {
    const date = new Date(start);
    return bucket === 'month'
        ? date.toLocaleDateString('en-US', SHORT_MONTH)
        : date.toLocaleDateString('en-US', SHORT_DAY);
}

/** Tooltip text: "Sep 23, 2026" / "Week of Sep 21, 2026" / "September 2026". */
export function formatBucketLong(start: number, bucket: Bucket): string {
    const date = new Date(start);
    switch (bucket) {
        case 'day':
            return date.toLocaleDateString('en-US', LONG_DAY);
        case 'week':
            return `Week of ${date.toLocaleDateString('en-US', LONG_DAY)}`;
        case 'month':
            return date.toLocaleDateString('en-US', LONG_MONTH);
    }
}

/** "this week" / "today" / "this month" — the label of the latest bucket. */
export function currentBucketLabel(bucket: Bucket): string {
    return bucket === 'day' ? 'today' : `this ${bucket}`;
}
