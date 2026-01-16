import React, { useRef, useEffect, useState, useCallback } from 'react';

interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    className?: string; // Additional classes for container
    onPointerDown?: () => void;
    onPointerUp?: () => void;
    disabled?: boolean;
    showTooltip?: boolean;
    decimals?: number;
    units?: string;
    label?: string;
}

// Configurable Height Constant
const SLIDER_HEIGHT = 20; // Container height for touch target
const TRACK_HEIGHT = 4; // Visual track height
const THUMB_SIZE = 12; // Thumb diameter
const THUMB_RADIUS = THUMB_SIZE / 2;
const PADDING = 2; // Keep some padding for touch target calculation safety

export const Slider: React.FC<SliderProps> = ({
    value,
    onChange,
    min = 0,
    max = 100,
    className = '',
    onPointerDown,
    onPointerUp,
    disabled = false,
    showTooltip = false,
    decimals = 0,
    units = '',
    label
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Calculate percentage 0..1
    const clampedValue = Math.min(Math.max(value, min), max);
    const fraction = (clampedValue - min) / (max - min);

    const handleInteraction = useCallback((clientX: number) => {
        if (!containerRef.current || disabled) return;

        const rect = containerRef.current.getBoundingClientRect();
        const width = rect.width;

        // Effective interactive width is the full width minus the thumb size (to keep thumb inside ends)
        // We want the center of the thumb to go from 0 to width
        // But visually we usually constrain it so thumb doesn't overflow.
        // Let's keep the existing logic:
        // track starts at PADDING + THUMB_RADIUS and ends at width - PADDING - THUMB_RADIUS
        // But for a thin slider visually we might want the thumb to go potentially to the very edge?
        // Let's stick to the previous safe padding logic for now to ensure no overlap issues,
        // but can adjust if user wants full-width edge-to-edge.

        const relativeX = clientX - rect.left;
        const effectivePos = relativeX - (PADDING + THUMB_RADIUS);
        const travelLength = width - (PADDING * 2) - THUMB_SIZE;

        let rawFraction = 0;
        if (travelLength > 0) {
            rawFraction = effectivePos / travelLength;
        }

        rawFraction = Math.max(0, Math.min(1, rawFraction));
        let newValue = min + rawFraction * (max - min);

        // Clamp again
        newValue = Math.min(Math.max(newValue, min), max);

        onChange(newValue);
    }, [max, min, onChange, disabled]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (disabled) return;
        e.preventDefault();
        setIsDragging(true);
        if (onPointerDown) onPointerDown();
        handleInteraction(e.clientX);
    };

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (isDragging) {
                handleInteraction(e.clientX);
            }
        };

        const handlePointerUp = () => {
            if (isDragging) {
                setIsDragging(false);
                if (onPointerUp) onPointerUp();
            }
        };

        if (isDragging) {
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        }

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isDragging, handleInteraction, onPointerUp]);

    // Calculate thumb position for style
    const thumbLeft = `calc(${PADDING}px + ${THUMB_RADIUS}px + (100% - ${PADDING * 2}px - ${THUMB_SIZE}px) * ${fraction})`;

    return (
        <div className={`w-full ${className}`}>
            {label && (
                <label className="text-xs text-gray-400 mb-2 block">
                    {label}
                </label>
            )}

            <div
                ref={containerRef}
                onPointerDown={handlePointerDown}
                style={{ height: `${SLIDER_HEIGHT}px` }}
                className={`
                    relative w-full touch-none select-none group flex items-center
                    ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                `}
            >
                {/* Visual Track - Full Width Background (Inactive part) */}
                <div
                    className="absolute left-0 right-0 rounded-full bg-text-disabled"
                    style={{
                        height: `${TRACK_HEIGHT}px`,
                        left: `${PADDING}px`,
                        right: `${PADDING}px`
                    }}
                >
                    {/* Active Track (Left side) */}
                    <div
                        className="absolute top-0 left-0 bottom-0 bg-text-main rounded-full"
                        style={{
                            width: `calc(${fraction} * 100%)`
                        }}
                    />
                </div>

                {/* Marker / Thumb */}
                <div
                    className="absolute rounded-full pointer-events-none z-10 flex items-center justify-center"
                    style={{
                        height: `${THUMB_SIZE + 12}px`,
                        width: `${THUMB_SIZE + 12}px`,
                        left: thumbLeft,
                        transform: `translate(-50%, 0)`
                    }}
                >
                    {/* Hover Halo */}
                    <div
                        className={`absolute inset-0 rounded-full bg-hover-subtle transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                    />
                    {/* Thumb */}
                    <div
                        className="bg-white rounded-full shadow-sm transition-transform"
                        style={{
                            height: `${THUMB_SIZE}px`,
                            width: `${THUMB_SIZE}px`,
                        }}
                    />
                </div>

                {/* Tooltip */}
                {showTooltip && isDragging && (
                    <div
                        className="absolute bg-primary bottom-full mb-1 flex flex-col items-center pointer-events-none z-20 rounded-full"
                        style={{
                            left: thumbLeft,
                            transform: `translate(-50%, 0)`
                        }}
                    >
                        <div className="bg-tertiary text-text-on-primary text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                            {value.toFixed(decimals)}{units}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
