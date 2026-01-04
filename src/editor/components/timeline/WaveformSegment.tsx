import React, { useMemo, useRef, useEffect } from 'react';

interface WaveformSegmentProps {
    peaks: number[]; // Full cached peaks for the source
    sourceStartMs: number; // Where this segment starts in source time
    sourceEndMs: number;   // Where this segment ends in source time
    width: number; // Render width in px
    height: number;
    color: string;
}

const PEAKS_SAMPLES_PER_SEC = 100;

const WaveformSegmentComponent: React.FC<WaveformSegmentProps> = ({
    peaks,
    sourceStartMs,
    sourceEndMs,
    width,
    height,
    color
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Calculate which slice of peaks to show
    // peaks array is 100 per sec.
    // Index = (ms / 1000) * 100
    const startIndex = Math.floor((sourceStartMs / 1000) * PEAKS_SAMPLES_PER_SEC);
    const endIndex = Math.ceil((sourceEndMs / 1000) * PEAKS_SAMPLES_PER_SEC);

    const visiblePeaks = useMemo(() => {
        // Clamp
        const start = Math.max(0, startIndex);
        const end = Math.min(peaks.length, endIndex);
        return peaks.slice(start, end);
    }, [peaks, startIndex, endIndex]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, width, height);

        if (visiblePeaks.length === 0) return;

        // Drawing params
        ctx.fillStyle = color;
        const barWidth = width / visiblePeaks.length;
        const gap = barWidth > 2 ? 1 : 0;
        const effectiveBarWidth = Math.max(0.5, barWidth - gap);

        const centerY = height / 2;
        const scaleY = height / 2; // Max height from center

        visiblePeaks.forEach((peak, i) => {
            const x = i * barWidth;
            const barHeight = peak * scaleY * 0.96; // Scale to 96% of half-height (2% padding)

            // Draw Top
            ctx.fillRect(x, centerY - barHeight, effectiveBarWidth, barHeight);

            // Draw Bottom (Mirrored)
            ctx.fillRect(x, centerY, effectiveBarWidth, barHeight);
        });

    }, [visiblePeaks, width, height, color]);



    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="pointer-events-none opacity-50"
            style={{ width, height }}
        />
    );
};

export const WaveformSegment = React.memo(WaveformSegmentComponent);
