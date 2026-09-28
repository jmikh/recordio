/**
 * Single-series time chart for the admin growth dashboard. Plain SVG —
 * no chart library. Rate draws columns (a count per bucket), cumulative
 * draws a line with a faint area wash and an end dot (a running total).
 *
 * Hover/keyboard: every bucket has a full-height hit slot; the hovered
 * bucket lifts its column (or shows a crosshair on the line) and a
 * tooltip reads the value. ← / → move the hovered bucket when the
 * chart has focus. Axis and tooltip text wear text tokens; only the
 * marks carry the series color.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    formatBucketLong,
    formatBucketShort,
    type Bucket,
    type Mode,
    type SeriesPoint,
} from './growthSeries';

export type ChartTone = 'primary' | 'tertiary';

interface TimeSeriesChartProps {
    points: SeriesPoint[];
    mode: Mode;
    bucket: Bucket;
    tone: ChartTone;
    /** Names the chart for assistive tech, e.g. "Accounts per week". */
    ariaLabel: string;
}

const HEIGHT = 240;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 48 };
const MAX_BAR = 24;
const BAR_GAP = 2;
const MIN_LABEL_SPACING = 72;

// Literal class names so Tailwind's scanner picks them up
const TONE = {
    primary: { fill: 'fill-primary', stroke: 'stroke-primary' },
    tertiary: { fill: 'fill-tertiary', stroke: 'stroke-tertiary' },
} as const;

/** Round-number y ticks: 0 .. a clean ceiling above `max`, ~4 steps. */
function niceTicks(max: number): number[] {
    if (max <= 0) return [0, 1];
    const rough = max / 4;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const candidates = [1, 2, 2.5, 5, 10].map(m => m * pow);
    const step = candidates.find(c => c >= rough) ?? candidates[candidates.length - 1];
    const top = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    return ticks;
}

/** Column with a rounded cap and a square base. Radius shrinks for tiny bars. */
function columnPath(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, h, w / 2);
    if (h <= 0) return '';
    return [
        `M${x},${y + r}`,
        `a${r},${r} 0 0 1 ${r},-${r}`,
        `h${w - 2 * r}`,
        `a${r},${r} 0 0 1 ${r},${r}`,
        `v${h - r}`,
        `h${-w}`,
        'Z',
    ].join(' ');
}

export function TimeSeriesChart({ points, mode, bucket, tone, ariaLabel }: TimeSeriesChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    // Hover is remembered against the series it was set on, so a new
    // series (a toggle flip) drops it without an effect
    const [hoverState, setHoverState] = useState<{ points: SeriesPoint[]; index: number } | null>(null);
    const hovered = hoverState && hoverState.points === points ? hoverState.index : null;
    const setHovered = (index: number | null) =>
        setHoverState(index === null ? null : { points, index });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            setWidth(entries[0].contentRect.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const plot = useMemo(() => {
        const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
        const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
        const n = points.length;
        const slotW = n > 0 ? plotW / n : 0;
        const ticks = niceTicks(Math.max(0, ...points.map(p => p.value)));
        const yMax = ticks[ticks.length - 1];
        const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;
        const xCenter = (i: number) => MARGIN.left + (i + 0.5) * slotW;
        const baseline = MARGIN.top + plotH;
        const labelEvery = slotW > 0 ? Math.max(1, Math.ceil(MIN_LABEL_SPACING / slotW)) : 1;
        return { plotW, plotH, slotW, ticks, yMax, y, xCenter, baseline, labelEvery };
    }, [width, points]);

    const { slotW, ticks, y, xCenter, baseline, labelEvery } = plot;
    const classes = TONE[tone];

    const linePath = useMemo(() => {
        if (mode !== 'cumulative' || points.length === 0) return '';
        return points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${xCenter(i).toFixed(1)},${y(p.value).toFixed(1)}`)
            .join(' ');
    }, [mode, points, xCenter, y]);

    const areaPath = linePath
        ? `${linePath} L${xCenter(points.length - 1).toFixed(1)},${baseline} L${xCenter(0).toFixed(1)},${baseline} Z`
        : '';

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (points.length === 0) return;
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            setHovered(Math.min((hovered ?? -1) + 1, points.length - 1));
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setHovered(Math.max((hovered ?? points.length) - 1, 0));
        } else if (e.key === 'Escape') {
            setHovered(null);
        }
    };

    const hoveredPoint = hovered !== null ? points[hovered] : null;
    const barW = Math.max(1, Math.min(MAX_BAR, slotW - BAR_GAP));

    return (
        <div ref={containerRef} className="relative w-full">
            {points.length === 0 ? (
                <div
                    className="flex items-center justify-center text-sm text-text-muted"
                    style={{ height: HEIGHT }}
                >
                    No data yet.
                </div>
            ) : (
                <svg
                    width={width}
                    height={HEIGHT}
                    role="img"
                    aria-label={ariaLabel}
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                    onMouseLeave={() => setHovered(null)}
                    onBlur={() => setHovered(null)}
                    className="block outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm"
                >
                    {/* Gridlines + y ticks */}
                    {ticks.map(t => (
                        <g key={t}>
                            <line
                                x1={MARGIN.left}
                                x2={MARGIN.left + plot.plotW}
                                y1={y(t)}
                                y2={y(t)}
                                className="stroke-border"
                                strokeWidth={1}
                            />
                            <text
                                x={MARGIN.left - 8}
                                y={y(t)}
                                textAnchor="end"
                                dominantBaseline="middle"
                                className="fill-text-muted text-2xs"
                            >
                                {t.toLocaleString()}
                            </text>
                        </g>
                    ))}

                    {/* x labels */}
                    {points.map((p, i) => (
                        i % labelEvery === 0 && (
                            <text
                                key={p.start}
                                x={xCenter(i)}
                                y={HEIGHT - 8}
                                textAnchor="middle"
                                className="fill-text-muted text-2xs"
                            >
                                {formatBucketShort(p.start, bucket)}
                            </text>
                        )
                    ))}

                    {/* Marks */}
                    {mode === 'rate' ? (
                        points.map((p, i) => (
                            <path
                                key={p.start}
                                d={columnPath(xCenter(i) - barW / 2, y(p.value), barW, baseline - y(p.value))}
                                className={`${classes.fill} transition-opacity ${
                                    hovered !== null && hovered !== i ? 'opacity-60' : ''
                                }`}
                            />
                        ))
                    ) : (
                        <>
                            <path d={areaPath} className={`${classes.fill} opacity-10`} />
                            <path
                                d={linePath}
                                fill="none"
                                className={classes.stroke}
                                strokeWidth={2}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                            {hoveredPoint && (
                                <line
                                    x1={xCenter(hovered!)}
                                    x2={xCenter(hovered!)}
                                    y1={MARGIN.top}
                                    y2={baseline}
                                    className="stroke-border-hover"
                                    strokeWidth={1}
                                />
                            )}
                            {/* End dot (or the hovered point) with a surface ring */}
                            {(() => {
                                const i = hovered ?? points.length - 1;
                                return (
                                    <circle
                                        cx={xCenter(i)}
                                        cy={y(points[i].value)}
                                        r={4}
                                        className={`${classes.fill} stroke-surface`}
                                        strokeWidth={2}
                                    />
                                );
                            })()}
                        </>
                    )}

                    {/* Hit slots — the whole column height, wider than any mark */}
                    {points.map((p, i) => (
                        <rect
                            key={p.start}
                            x={MARGIN.left + i * slotW}
                            y={MARGIN.top}
                            width={slotW}
                            height={plot.plotH}
                            fill="transparent"
                            onMouseEnter={() => setHovered(i)}
                        />
                    ))}
                </svg>
            )}

            {hoveredPoint && (
                <div
                    role="status"
                    className="absolute top-0 -translate-x-1/2 pointer-events-none bg-surface-raised border border-border rounded-md shadow-float px-3 py-2 whitespace-nowrap"
                    style={{ left: xCenter(hovered!) }}
                >
                    <div className="text-sm font-bold text-text-highlighted">
                        {hoveredPoint.value.toLocaleString()}
                    </div>
                    <div className="text-label">{formatBucketLong(hoveredPoint.start, bucket)}</div>
                </div>
            )}
        </div>
    );
}
