/**
 * /admin/growth — accounts and projects created over time. One fetch
 * of the whole per-day history (admin-growth-stats); the rate/
 * cumulative, day/week/month and range switches re-bucket it client-
 * side (growthSeries.ts). The switches scope both charts at once so
 * the two always agree.
 */
import { useEffect, useMemo, useState } from 'react';
import { LuLoader } from 'react-icons/lu';
import { MultiToggle } from '@shared/components';
import type { AdminDailyCount, AdminGrowthStatsResponse } from '@shared/api';
import { invokeFunction } from '../../api/client';
import {
    buildSeries,
    currentBucketLabel,
    totalCount,
    type Bucket,
    type Mode,
    type Range,
} from './growthSeries';
import { TimeSeriesChart, type ChartTone } from './TimeSeriesChart';

type Status = 'loading' | 'ready' | 'error';

const MODE_OPTIONS: Array<{ value: Mode; label: string }> = [
    { value: 'rate', label: 'Rate' },
    { value: 'cumulative', label: 'Cumulative' },
];
const BUCKET_OPTIONS: Array<{ value: Bucket; label: string }> = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
];
const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: '1y', label: '1y' },
    { value: 'all', label: 'All' },
];

interface GrowthCardProps {
    title: string;
    /** "accounts" / "projects" — for the chart's accessible name and stat labels. */
    noun: string;
    rows: AdminDailyCount[];
    mode: Mode;
    bucket: Bucket;
    range: Range;
    tone: ChartTone;
    now: number;
}

function GrowthCard({ title, noun, rows, mode, bucket, range, tone, now }: GrowthCardProps) {
    const series = useMemo(
        () => buildSeries(rows, { bucket, mode, range, now }),
        [rows, bucket, mode, range, now],
    );
    // The latest bucket's own count, whichever mode is showing
    const latest = useMemo(() => {
        const rate = buildSeries(rows, { bucket, mode: 'rate', range: 'all', now });
        return rate.length > 0 ? rate[rate.length - 1].value : 0;
    }, [rows, bucket, now]);
    const total = totalCount(rows);
    const chartLabel = mode === 'rate'
        ? `${title} created per ${bucket}`
        : `Total ${noun} over time`;

    return (
        <section
            aria-label={title}
            className="bg-surface border border-border rounded-md p-4"
        >
            <div className="flex items-baseline justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-sm text-text-highlighted font-bold">{title}</h2>
                    <p className="text-label">{chartLabel}</p>
                </div>
                <div className="text-right">
                    <div className="heading-2">{total.toLocaleString()}</div>
                    <p className="text-label">
                        +{latest.toLocaleString()} {currentBucketLabel(bucket)}
                    </p>
                </div>
            </div>
            <TimeSeriesChart
                points={series}
                mode={mode}
                bucket={bucket}
                tone={tone}
                ariaLabel={chartLabel}
            />
        </section>
    );
}

export function GrowthPanel() {
    const [status, setStatus] = useState<Status>('loading');
    const [stats, setStats] = useState<AdminGrowthStatsResponse | null>(null);
    const [mode, setMode] = useState<Mode>('rate');
    const [bucket, setBucket] = useState<Bucket>('week');
    const [range, setRange] = useState<Range>('90d');
    // Fixed at load so every re-bucket agrees on "today"
    const [now] = useState(() => Date.now());

    useEffect(() => {
        (async () => {
            const { data, error } = await invokeFunction('admin-growth-stats', {});
            if (error || !data) {
                setStatus('error');
                return;
            }
            setStats(data);
            setStatus('ready');
        })();
    }, []);

    return (
        <div>
            <h1 className="heading-2 mb-1">Growth</h1>
            <p className="text-label mb-6">
                Accounts and projects created over time. Rate is the count per bucket;
                cumulative is the running total.
            </p>

            {status === 'loading' && (
                <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
                    <LuLoader className="icon-md animate-spin" />
                    Loading growth...
                </div>
            )}

            {status === 'error' && (
                <p className="text-sm text-destructive" role="alert">Failed to load growth stats.</p>
            )}

            {status === 'ready' && stats && (
                <>
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                        <div role="group" aria-label="Mode">
                            <MultiToggle options={MODE_OPTIONS} value={mode} onChange={setMode} />
                        </div>
                        <div role="group" aria-label="Bucket">
                            <MultiToggle options={BUCKET_OPTIONS} value={bucket} onChange={setBucket} />
                        </div>
                        <div role="group" aria-label="Range">
                            <MultiToggle options={RANGE_OPTIONS} value={range} onChange={setRange} />
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <GrowthCard
                            title="Accounts"
                            noun="accounts"
                            rows={stats.accounts}
                            mode={mode}
                            bucket={bucket}
                            range={range}
                            tone="primary"
                            now={now}
                        />
                        <GrowthCard
                            title="Projects"
                            noun="projects"
                            rows={stats.projects}
                            mode={mode}
                            bucket={bucket}
                            range={range}
                            tone="tertiary"
                            now={now}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
