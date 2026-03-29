import React from 'react';
import type { InteractionType } from './types';
import {
    CORNER_HANDLE_LENGTH,
    CORNER_HANDLE_THICKNESS,
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
    color?: string;
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
    color,
    onPointerDown
}) => {
    const isNorth = type.includes('n');
    const isWest = type.includes('w');

    // Use passed color as the secondary border, otherwise fallback.
    // The core itself is always white to maintain premium UI styling.
    const borderColor = color ?? 'var(--color-secondary)';

    // We use a 24x24 SVG container to safely host the path and its strokes without clipping
    const SVG_SIZE = 24;

    // The visual length of the L handle arm (outer edge)
    const LENGTH = CORNER_HANDLE_LENGTH;
    // The visual thickness of the white core of the L handle arm
    const THICKNESS = CORNER_HANDLE_THICKNESS;

    // The L shape is built such that its "corner" that the user interacts with
    // is aligned to a specific coordinate in the SVG.
    // For NW, the polygon inner corner is at (4,4) but we want the center of the outer
    // edge's thickness to straddle the bounding box border perfectly.
    // X=4, Y=4 is the outer corner of the polygon.
    // The center line of the thickness is X=4+(THICKNESS/2), Y=4+(THICKNESS/2).
    // So the alignment point we want exactly on the bounding box corner is (6,6).
    const alignmentOffset = -(4 + THICKNESS / 2);

    // Determine rotation based on compass direction to reuse the exact same SVG path
    let rotation = 0;
    if (type === 'ne') rotation = 90;
    else if (type === 'se') rotation = 180;
    else if (type === 'sw') rotation = 270;

    // By setting top/left to `alignmentOffset`, we ensure the symmetric (6,6) 
    // center point of the SVG perfectly sits on the (0,0) corner of the bounding box.
    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        width: SVG_SIZE,
        height: SVG_SIZE,
        cursor,
        zIndex: Z_INDEX_CORNER_HANDLE,
        transform: `rotate(${rotation}deg)`,
        ...(isNorth ? { top: alignmentOffset } : { bottom: alignmentOffset }),
        ...(isWest ? { left: alignmentOffset } : { right: alignmentOffset }),
    };

    // Construct the NW polygon path string dynamically
    // A 4px thick, 16px long L shape offset by 4px from top-left (to leave room for stroke)
    const pt1 = `4,${4 + LENGTH}`;
    const pt2 = `4,4`;
    const pt3 = `${4 + LENGTH},4`;
    const pt4 = `${4 + LENGTH},${4 + THICKNESS}`;
    const pt5 = `${4 + THICKNESS},${4 + THICKNESS}`;
    const pt6 = `${4 + THICKNESS},${4 + LENGTH}`;
    const points = `${pt1} ${pt2} ${pt3} ${pt4} ${pt5} ${pt6}`;

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        >
            <svg width="100%" height="100%" viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} style={{ overflow: 'visible' }}>
                {/* Black outer border */}
                <polygon
                    points={points}
                    fill="none"
                    stroke="rgba(0,0,0,0.8)"
                    strokeWidth={4}
                    strokeLinejoin="miter"
                />
                {/* Secondary color inner border */}
                <polygon
                    points={points}
                    fill="none"
                    stroke={borderColor}
                    strokeWidth={2}
                    strokeLinejoin="miter"
                />
                {/* White core */}
                <polygon
                    points={points}
                    fill="white"
                    stroke="none"
                />
            </svg>
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
