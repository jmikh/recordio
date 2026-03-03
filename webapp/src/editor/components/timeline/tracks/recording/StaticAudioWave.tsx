import React, { useMemo, useRef, useEffect } from 'react';
import { AUDIO_PEAKS_SAMPLES_PER_SEC } from '../../../../../core/audioConstants';

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

        canvas.width = canvasWidth;
        canvas.height = height;
        canvas.style.width = `${canvasWidth}px`;
        canvas.style.height = `${height}px`;
        canvas.style.transform = `translateX(${clampedStart}px)`;

        ctx.clearRect(0, 0, canvasWidth, height);
        ctx.fillStyle = WAVEFORM_COLOR;

        const barWidth = width / visiblePeaks.length;
        const scaleY = height * 0.96;

        // Only draw bars that fall within the visible canvas
        const firstBar = Math.max(0, Math.floor(clampedStart / barWidth));
        const lastBar = Math.min(visiblePeaks.length - 1, Math.ceil(clampedEnd / barWidth));

        for (let i = firstBar; i <= lastBar; i++) {
            const x = i * barWidth - clampedStart; // position relative to canvas origin
            const barHeight = visiblePeaks[i] * scaleY;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        }

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
