import React, { useRef, useEffect, useState, useCallback } from 'react';

interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    className?: string; // Additional classes for container
    onPointerDown?: () => void;
    onPointerUp?: () => void;
}

// Configurable Height Constant
const SLIDER_HEIGHT = 16; // Easy to change, affecting all instances

// Derived Dimensions
const PADDING = 2; // Padding for all sides (top/bottom/left/right)
// Top/Bottom: Matches "top-1 bottom-1" style
// Left/Right: Insets the slider travel range
// Extension: Used to extend the track past the marker

const THUMB_SIZE = SLIDER_HEIGHT - (PADDING * 2);
const THUMB_RADIUS = THUMB_SIZE / 2;

export const Slider: React.FC<SliderProps> = ({
    value,
    onChange,
    min = 0,
    max = 100,
    className = '',
    onPointerDown,
    onPointerUp
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Calculate percentage 0..1 for internal logic
    const clampedValue = Math.min(Math.max(value, min), max);
    const fraction = (clampedValue - min) / (max - min);

    const handleInteraction = useCallback((clientX: number) => {
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const width = rect.width;

        let relativeX = clientX - rect.left;

        // Effective position starts after the left padding + radius
        let effectivePos = relativeX - (PADDING + THUMB_RADIUS);

        // Total travel length is reduced by padding on both sides
        let travelLength = width - (PADDING * 2) - THUMB_SIZE;

        let rawFraction = 0;
        if (travelLength > 0) {
            rawFraction = effectivePos / travelLength;
        }

        rawFraction = Math.max(0, Math.min(1, rawFraction));

        let newValue = min + rawFraction * (max - min);

        // No step logic - continuous

        // Clamp again just in case rounding pushed it out
        newValue = Math.min(Math.max(newValue, min), max);

        onChange(newValue);
    }, [max, min, onChange]);

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault(); // Prevent text selection
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

    return (
        // Container with explicit height
        <div
            ref={containerRef}
            onPointerDown={handlePointerDown}
            style={{ height: `${SLIDER_HEIGHT}px` }}
            className={`
                relative w-full rounded-full overflow-hidden cursor-pointer touch-none shadow-inner-bold
                bg-surface select-none
                ${className}
            `}
        >
            {/* Left Track (Primary Color) 
                Width calculation uses PADDING to ensure alignment.
                Starts at 0.
                Length = Left Padding + Thumb Size + Travel * Fraction + Extension (Padding)
            */}
            <div
                className="absolute top-0 left-0 bottom-0 bg-secondary border border-secondary pointer-events-none rounded-full shadow-inner-bold"
                style={{
                    width: `calc(${PADDING}px + ${THUMB_SIZE}px + (100% - ${PADDING * 2}px - ${THUMB_SIZE}px) * ${fraction} + ${PADDING}px)`
                }}
            />

            {/* Marker / Thumb 
                Left calculation starts at PADDING + THUMB_RADIUS
                Travels for (100% - PADDING*2 - THUMB_SIZE)
            */}
            <div
                className="absolute top-1 bottom-1 aspect-square bg-surface rounded-full pointer-events-none transition-transform active:scale-95 shadow-inner-bold"
                style={{
                    left: `calc(${PADDING}px + ${THUMB_RADIUS}px + (100% - ${PADDING * 2}px - ${THUMB_SIZE}px) * ${fraction})`,
                    transform: `translate(-50%, 0)`
                }}
            />
        </div>
    );
};
