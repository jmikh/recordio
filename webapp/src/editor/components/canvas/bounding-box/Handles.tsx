import React from 'react';
import type { InteractionType } from './types';
import {
    CORNER_HANDLE_LENGTH,
    CORNER_HANDLE_THICKNESS,
    CORNER_HANDLE_COLOR,
    EDGE_HIT_AREA_WIDTH,
    EDGE_CORNER_OFFSET,
    Z_INDEX_CORNER_HANDLE,
    Z_INDEX_EDGE_HANDLE,
} from './constants';

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------

export interface HandleProps {
    type: InteractionType;
    cursor: string;
    onPointerDown: (e: React.PointerEvent, type: InteractionType) => void;
}

// ------------------------------------------------------------------
// L-SHAPED CORNER HANDLE
// ------------------------------------------------------------------

/**
 * L-shaped corner resize handle.
 * Renders two perpendicular bars meeting at the corner.
 */

const HIT_AREA = CORNER_HANDLE_LENGTH + 4;

export const Handle: React.FC<HandleProps> = ({
    type,
    cursor,
    onPointerDown
}) => {
    const isNorth = type.includes('n');
    const isWest = type.includes('w');

    // Hit area container positioned at the corner
    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        width: HIT_AREA,
        height: HIT_AREA,
        cursor,
        zIndex: Z_INDEX_CORNER_HANDLE,
        ...(isNorth ? { top: -HIT_AREA / 2 } : { bottom: -HIT_AREA / 2 }),
        ...(isWest ? { left: -HIT_AREA / 2 } : { right: -HIT_AREA / 2 }),
    };

    // Horizontal arm of the L (extends outward from corner)
    const hBarStyle: React.CSSProperties = {
        position: 'absolute',
        width: CORNER_HANDLE_LENGTH,
        height: CORNER_HANDLE_THICKNESS,
        backgroundColor: CORNER_HANDLE_COLOR,
        ...(isNorth ? { top: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 } : { bottom: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 }),
        ...(isWest ? { right: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 } : { left: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 }),
    };

    // Vertical arm of the L (extends outward from corner)
    const vBarStyle: React.CSSProperties = {
        position: 'absolute',
        width: CORNER_HANDLE_THICKNESS,
        height: CORNER_HANDLE_LENGTH,
        backgroundColor: CORNER_HANDLE_COLOR,
        ...(isNorth ? { bottom: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 } : { top: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 }),
        ...(isWest ? { left: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 } : { right: HIT_AREA / 2 - CORNER_HANDLE_THICKNESS / 2 }),
    };

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        >
            <div style={hBarStyle} />
            <div style={vBarStyle} />
        </div>
    );
};

// ------------------------------------------------------------------
// INVISIBLE EDGE HANDLE
// ------------------------------------------------------------------

/**
 * Invisible edge handle for one-dimensional resize.
 * Provides a large hit area along the full edge.
 */
export const EdgeHandle: React.FC<HandleProps> = ({
    type,
    cursor,
    onPointerDown
}) => {
    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        cursor: cursor,
        zIndex: Z_INDEX_EDGE_HANDLE,
        background: 'transparent',
    };

    // Each edge handle spans the full length minus corners
    switch (type) {
        case 'n':
            containerStyle.top = -EDGE_HIT_AREA_WIDTH / 2;
            containerStyle.left = EDGE_CORNER_OFFSET;
            containerStyle.right = EDGE_CORNER_OFFSET;
            containerStyle.height = EDGE_HIT_AREA_WIDTH;
            break;
        case 's':
            containerStyle.bottom = -EDGE_HIT_AREA_WIDTH / 2;
            containerStyle.left = EDGE_CORNER_OFFSET;
            containerStyle.right = EDGE_CORNER_OFFSET;
            containerStyle.height = EDGE_HIT_AREA_WIDTH;
            break;
        case 'w':
            containerStyle.left = -EDGE_HIT_AREA_WIDTH / 2;
            containerStyle.top = EDGE_CORNER_OFFSET;
            containerStyle.bottom = EDGE_CORNER_OFFSET;
            containerStyle.width = EDGE_HIT_AREA_WIDTH;
            break;
        case 'e':
            containerStyle.right = -EDGE_HIT_AREA_WIDTH / 2;
            containerStyle.top = EDGE_CORNER_OFFSET;
            containerStyle.bottom = EDGE_CORNER_OFFSET;
            containerStyle.width = EDGE_HIT_AREA_WIDTH;
            break;
    }

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        />
    );
};
