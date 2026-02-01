import React from 'react';
import type { InteractionType } from './types';
import {
    CORNER_HANDLE_SIZE,
    EDGE_HIT_AREA_WIDTH,
    EDGE_CORNER_OFFSET,
    PRIMARY_COLOR,
    HANDLE_BORDER_COLOR,
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
// SQUARE CORNER HANDLE
// ------------------------------------------------------------------

/**
 * Square corner resize handle.
 * Positioned at corners of the bounding box.
 */
export const Handle: React.FC<HandleProps> = ({
    type,
    cursor,
    onPointerDown
}) => {
    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        width: CORNER_HANDLE_SIZE,
        height: CORNER_HANDLE_SIZE,
        backgroundColor: PRIMARY_COLOR,
        border: `1.5px solid ${HANDLE_BORDER_COLOR}`,
        cursor: cursor,
        zIndex: Z_INDEX_CORNER_HANDLE,
        boxSizing: 'border-box',
    };

    // Position based on corner type
    const isNorth = type.includes('n');
    const isWest = type.includes('w');

    if (isNorth) {
        containerStyle.top = -CORNER_HANDLE_SIZE / 2;
    } else {
        containerStyle.bottom = -CORNER_HANDLE_SIZE / 2;
    }

    if (isWest) {
        containerStyle.left = -CORNER_HANDLE_SIZE / 2;
    } else {
        containerStyle.right = -CORNER_HANDLE_SIZE / 2;
    }

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        />
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
