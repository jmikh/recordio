import React from 'react';
import { transitionTrail, holdLine } from './ZoomTrackStyles';

interface LineProps {
    /** Left position in pixels */
    left: number;
    /** Width in pixels */
    width: number;
}

/**
 * Transition trail - thicker line leading into a keyframe.
 * Represents the zoom animation duration.
 */
export const TransitionTrail: React.FC<LineProps & { isSelected?: boolean }> = ({
    left,
    width,
    isSelected = false,
}) => {
    if (width <= 0) return null;

    const colorClass = isSelected ? transitionTrail.selected : transitionTrail.default;

    return (
        <div
            className={`${transitionTrail.base} ${colorClass}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: transitionTrail.height,
                opacity: transitionTrail.opacity,
            }}
        />
    );
};

/**
 * Hold line - thin semi-transparent line between zoomed keyframes.
 * Represents the period where zoom holds steady.
 */
export const HoldLine: React.FC<LineProps & { isSelected?: boolean }> = ({
    left,
    width,
    isSelected = false,
}) => {
    if (width <= 0) return null;

    const colorClass = isSelected ? holdLine.selected : holdLine.default;

    return (
        <div
            className={`${holdLine.base} ${colorClass}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: holdLine.height,
                opacity: holdLine.opacity,
            }}
        />
    );
};
