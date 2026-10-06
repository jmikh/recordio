import React, { useMemo, useRef, useEffect } from 'react';
import { AUDIO_PEAKS_SAMPLES_PER_SEC } from '../../../../audio/audioConstants';

interface StaticAudioWaveProps {
    peaks: number[]; // Full cached peaks for the source
    sourceStartTimeMs: number; // Where this segment starts in source time
    sourceEndTimeMs: number;   // Where this segment ends in source time
    width: number; // Full segment render width in px
    height: number;
    /** Scroll offset of the timeline container */
    scrollLeft?: number;
    /** Visible width of the timeline container */
    containerWidth?: number;
    /** Left position of this segment inside the scrollable area */
    segmentLeft?: number;
}

const WAVEFORM_COLOR = 'rgba(255, 255, 255, 1)';
const BUFFER = 200; // extra px each side for smooth scroll
const MIN_POINT_SPACING_PX = 3; // zoomed out, peaks are merged so curve points are at least this far apart

const StaticAudioWaveComponent: React.FC<StaticAudioWaveProps> = ({
    peaks,
    sourceStartTimeMs,
    sourceEndTimeMs,
    width,
    height,
    scrollLeft = 0,
    containerWidth = 0,
    segmentLeft = 0,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Calculate which slice of peaks to show
    const startIndex = Math.floor((sourceStartTimeMs / 1000) * AUDIO_PEAKS_SAMPLES_PER_SEC);
    const endIndex = Math.ceil((sourceEndTimeMs / 1000) * AUDIO_PEAKS_SAMPLES_PER_SEC);

    const visiblePeaks = useMemo(() => {
        const start = Math.max(0, startIndex);
        const end = Math.min(peaks.length, endIndex);
        return peaks.slice(start, end);
    }, [peaks, startIndex, endIndex]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (visiblePeaks.length === 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // Viewport-aware: compute which portion of this segment is visible
        const viewportWidth = containerWidth || window.innerWidth;
        const viewStart = Math.max(0, scrollLeft - segmentLeft - BUFFER);
        const viewEnd = Math.min(width, scrollLeft - segmentLeft + viewportWidth + BUFFER);

        // If the segment is entirely off-screen, skip rendering
        if (viewEnd <= 0 || viewStart >= width) {
            canvas.width = 0;
            canvas.height = 0;
            return;
        }

        const clampedStart = Math.max(0, viewStart);
        const clampedEnd = Math.min(width, viewEnd);
        const canvasWidth = clampedEnd - clampedStart;

        // Back the canvas at device resolution so the curve edges stay crisp on HiDPI
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvasWidth * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${canvasWidth}px`;
        canvas.style.height = `${height}px`;
        canvas.style.transform = `translateX(${clampedStart}px)`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvasWidth, height);
        ctx.fillStyle = WAVEFORM_COLOR;

        const peakCount = visiblePeaks.length;
        const pxPerPeak = width / peakCount;
        const scaleY = height * 0.96;

        // When zoomed out, merge neighbouring peaks (max) so curve points stay at least
        // MIN_POINT_SPACING_PX apart. Buckets align to absolute peak indices, not the
        // viewport, so the shape doesn't shimmer while scrolling.
        const bucket = Math.max(1, Math.ceil(MIN_POINT_SPACING_PX / pxPerPeak));
        const bucketPx = bucket * pxPerPeak;
        const bucketCount = Math.ceil(peakCount / bucket);
        // One extra bucket each side so the curve enters/leaves the canvas smoothly
        const firstBucket = Math.max(0, Math.floor(clampedStart / bucketPx) - 1);
        const lastBucket = Math.min(bucketCount - 1, Math.ceil(clampedEnd / bucketPx) + 1);

        const points: { x: number; y: number }[] = [];
        for (let b = firstBucket; b <= lastBucket; b++) {
            const from = b * bucket;
            const to = Math.min(peakCount, from + bucket);
            let peak = 0;
            for (let i = from; i < to; i++) {
                if (visiblePeaks[i] > peak) peak = visiblePeaks[i];
            }
            // Point sits at the bucket centre, relative to canvas origin
            points.push({ x: ((from + to) / 2) * pxPerPeak - clampedStart, y: height - peak * scaleY });
        }
        if (points.length === 0) return;

        // Extend flat to the segment edges so the wave fills the whole block
        if (firstBucket === 0) points.unshift({ x: -clampedStart, y: points[0].y });
        if (lastBucket === bucketCount - 1) points.push({ x: width - clampedStart, y: points[points.length - 1].y });

        // Quadratic curves between midpoints, using each point as the control point:
        // C1-smooth at any zoom, and never overshoots the peak range (unlike Catmull-Rom)
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.moveTo(points[0].x, height);
        ctx.lineTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
            const p = points[i];
            const next = points[i + 1];
            ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
        }
        ctx.lineTo(last.x, last.y);
        ctx.lineTo(last.x, height);
        ctx.closePath();
        ctx.fill();

    }, [visiblePeaks, width, height, scrollLeft, containerWidth, segmentLeft]);

    return (
        <canvas
            ref={canvasRef}
            className="pointer-events-none opacity-40 absolute left-0 top-0"
            style={{ height }}
        />
    );
};

export const StaticAudioWave = React.memo(StaticAudioWaveComponent);
