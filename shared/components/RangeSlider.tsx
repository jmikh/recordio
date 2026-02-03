import React, { useRef, useState, useCallback } from 'react';

interface RangeSliderProps {
    minValue: number;
    maxValue: number;
    onChange: (min: number, max: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    onPointerDown?: () => void;
    onPointerUp?: () => void;
}

export const RangeSlider: React.FC<RangeSliderProps> = ({
    minValue,
    maxValue,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    className = '',
    onPointerDown,
    onPointerUp
}) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState<'min' | 'max' | null>(null);

    const getValueFromPosition = useCallback((clientX: number) => {
        if (!trackRef.current) return min;
        const rect = trackRef.current.getBoundingClientRect();
        const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const rawValue = min + percentage * (max - min);
        return Math.round(rawValue / step) * step;
    }, [min, max, step]);

    const handlePointerDown = useCallback((thumb: 'min' | 'max') => (e: React.PointerEvent) => {
        e.preventDefault();
        setDragging(thumb);
        onPointerDown?.();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [onPointerDown]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragging) return;
        const newValue = getValueFromPosition(e.clientX);

        if (dragging === 'min') {
            const clampedMin = Math.min(newValue, maxValue - step);
            onChange(Math.max(min, clampedMin), maxValue);
        } else {
            const clampedMax = Math.max(newValue, minValue + step);
            onChange(minValue, Math.min(max, clampedMax));
        }
    }, [dragging, getValueFromPosition, minValue, maxValue, onChange, min, max, step]);

    const handlePointerUp = useCallback(() => {
        if (dragging) {
            setDragging(null);
            onPointerUp?.();
        }
    }, [dragging, onPointerUp]);

    // Calculate positions as percentages
    const minPercent = ((minValue - min) / (max - min)) * 100;
    const maxPercent = ((maxValue - min) / (max - min)) * 100;

    return (
        <div
            ref={trackRef}
            className={`relative h-1.5 bg-gray-700 rounded-lg cursor-pointer ${className}`}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            {/* Active range highlight */}
            <div
                className="absolute h-full bg-blue-500 rounded-lg"
                style={{
                    left: `${minPercent}%`,
                    width: `${maxPercent - minPercent}%`
                }}
            />

            {/* Min thumb */}
            <div
                className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full border-2 border-blue-500 cursor-grab shadow-md transition-transform hover:scale-110 ${dragging === 'min' ? 'scale-110 cursor-grabbing' : ''}`}
                style={{ left: `${minPercent}%`, transform: 'translate(-50%, -50%)' }}
                onPointerDown={handlePointerDown('min')}
            />

            {/* Max thumb */}
            <div
                className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full border-2 border-blue-500 cursor-grab shadow-md transition-transform hover:scale-110 ${dragging === 'max' ? 'scale-110 cursor-grabbing' : ''}`}
                style={{ left: `${maxPercent}%`, transform: 'translate(-50%, -50%)' }}
                onPointerDown={handlePointerDown('max')}
            />
        </div>
    );
};
