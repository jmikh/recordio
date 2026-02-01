import React from 'react';
import type { Rect } from '../../../../core/types';
import type { CornerIndex } from './types';
import { useDisplayMapper } from '../../../hooks/useDisplayMapper';
import { RADIUS_HANDLE_SIZE, RADIUS_HANDLE_MIN_INSET, Z_INDEX_RADIUS_HANDLE, PRIMARY_COLOR } from './constants';

export interface CornerRadiusHandleProps {
    /** Which corner this handle controls */
    corner: CornerIndex;
    /** Current radius value in output pixels */
    radius: number;
    /** The bounding box rect in output coordinates */
    rect: Rect;
    /** Called during drag with new radius value */
    onRadiusChange: (corner: CornerIndex, radius: number) => void;
    /** Called when drag ends */
    onRadiusCommit: () => void;
    /** Called when drag starts */
    onDragStart?: () => void;
}

/**
 * Create a custom SVG cursor for corner radius editing.
 * Shows a curved arc oriented toward the corner being edited.
 */
function createCornerCursor(rotation: number): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <g transform="rotate(${rotation} 8 8)">
            <!-- White outline (drawn first, thicker) -->
            <path d="M 3 13 L 3 7 Q 3 3 7 3 L 13 3" 
                  fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>
            <!-- Black arc (drawn on top) -->
            <path d="M 3 13 L 3 7 Q 3 3 7 3 L 13 3" 
                  fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round"/>
        </g>
    </svg>`;
    return `url('data:image/svg+xml,${encodeURIComponent(svg)}') 8 8, pointer`;
}

/** Each corner needs a different rotation for the cursor */
const CURSOR_ROTATIONS: Record<CornerIndex, number> = {
    0: 0,    // Top-left: no rotation
    1: 90,   // Top-right: 90° clockwise
    2: 180,  // Bottom-right: 180°
    3: 270   // Bottom-left: 270°
};

/**
 * Figma-style corner radius drag handle.
 * Positioned along the diagonal inside the bounding box.
 * Uses display mapper for coordinate transformations.
 */
export const CornerRadiusHandle: React.FC<CornerRadiusHandleProps> = ({
    corner,
    radius,
    rect,
    onRadiusChange,
    onRadiusCommit,
    onDragStart,
}) => {
    const displayMapper = useDisplayMapper();

    // Calculate max possible radius (half of smaller dimension)
    const smallerDimension = Math.min(rect.width, rect.height);
    const maxRadius = smallerDimension / 2;
    const clampedRadius = Math.min(radius, maxRadius);

    // Calculate handle offset in output pixels, then convert to display pixels
    // Clamp offset to stay:
    // - At least RADIUS_HANDLE_MIN_INSET from the corner (minimum)
    // - At least RADIUS_HANDLE_MIN_INSET from the center (maximum = maxRadius - minInset)
    const maxInsetOutput = maxRadius - RADIUS_HANDLE_MIN_INSET;
    const effectiveOffsetOutput = Math.max(
        RADIUS_HANDLE_MIN_INSET,
        Math.min(clampedRadius, maxInsetOutput)
    );
    const offsetDisplayX = displayMapper.outputToDisplayLength(effectiveOffsetOutput);
    const offsetDisplayY = displayMapper.outputToDisplayLength(effectiveOffsetOutput);

    // Position based on corner (in display pixels)
    // Transform direction depends on which CSS property is used:
    // - left/top: use translate(-50%, -50%) to center at that position
    // - right: use translate(+50%, ...) since element is positioned from right edge
    // - bottom: use translate(..., +50%) since element is positioned from bottom edge
    const cornerStyles: Record<CornerIndex, React.CSSProperties> = {
        0: {
            top: offsetDisplayY,
            left: offsetDisplayX,
            transform: 'translate(-50%, -50%)',
            cursor: createCornerCursor(CURSOR_ROTATIONS[0])
        },
        1: {
            top: offsetDisplayY,
            right: offsetDisplayX,
            transform: 'translate(50%, -50%)',
            cursor: createCornerCursor(CURSOR_ROTATIONS[1])
        },
        2: {
            bottom: offsetDisplayY,
            right: offsetDisplayX,
            transform: 'translate(50%, 50%)',
            cursor: createCornerCursor(CURSOR_ROTATIONS[2])
        },
        3: {
            bottom: offsetDisplayY,
            left: offsetDisplayX,
            transform: 'translate(-50%, 50%)',
            cursor: createCornerCursor(CURSOR_ROTATIONS[3])
        }
    };

    const style: React.CSSProperties = {
        position: 'absolute',
        width: RADIUS_HANDLE_SIZE,
        height: RADIUS_HANDLE_SIZE,
        borderRadius: '50%',
        backgroundColor: 'white',
        border: `1px solid ${PRIMARY_COLOR}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        zIndex: Z_INDEX_RADIUS_HANDLE,
        pointerEvents: 'auto',
        ...cornerStyles[corner]
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDragStart?.();

        const startX = e.clientX;
        const startY = e.clientY;
        const startRadius = radius;
        const target = e.currentTarget;

        const onMove = (moveE: PointerEvent) => {
            // Get display pixel delta
            const deltaXDisplay = moveE.clientX - startX;
            const deltaYDisplay = moveE.clientY - startY;

            // Convert display delta to output pixels using displayMapper
            const deltaXOutput = displayMapper.displayToOutputLength(deltaXDisplay);
            const deltaYOutput = displayMapper.displayToOutputLength(deltaYDisplay);

            // Project mouse movement onto the diagonal direction for 1:1 tracking
            const sqrt2 = Math.sqrt(2);
            let radiusDelta = 0;
            switch (corner) {
                case 0: // Top-left: moving right/down increases
                    radiusDelta = (deltaXOutput + deltaYOutput) / sqrt2;
                    break;
                case 1: // Top-right: moving left/down increases
                    radiusDelta = (-deltaXOutput + deltaYOutput) / sqrt2;
                    break;
                case 2: // Bottom-right: moving left/up increases
                    radiusDelta = (-deltaXOutput - deltaYOutput) / sqrt2;
                    break;
                case 3: // Bottom-left: moving right/up increases
                    radiusDelta = (deltaXOutput - deltaYOutput) / sqrt2;
                    break;
            }

            const newRadius = Math.max(0, Math.min(maxRadius, startRadius + radiusDelta));
            onRadiusChange(corner, newRadius);
        };

        const onUp = () => {
            target.releasePointerCapture(e.pointerId);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            onRadiusCommit();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    return (
        <div
            style={style}
            onPointerDown={handlePointerDown}
            title={`Corner radius: ${Math.round(radius)}px`}
        />
    );
};
