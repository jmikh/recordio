import React, { useRef, useEffect } from 'react';
import type { Rect } from '../../../core/types';

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
export type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export interface BoundingBoxProps {
    /** Current rectangle in canvas coordinates */
    rect: Rect;
    /** Canvas dimensions for bounds checking */
    canvasSize: { width: number; height: number };
    /** Minimum size constraint (default: canvasSize / 5) */
    minSize?: number;
    /** Maximum bounds for the rectangle (default: canvasSize) */
    maxBounds?: { width: number; height: number };
    /** Whether to maintain aspect ratio during resize */
    maintainAspectRatio?: boolean;
    /** Callback when drag starts */
    onDragStart?: () => void;
    /** Callback when rect changes during drag */
    onChange: (rect: Rect) => void;
    /** Callback when drag ends */
    onCommit: (rect: Rect) => void;
    /** Optional children to render inside the box */
    children?: React.ReactNode;
}

// ------------------------------------------------------------------
// COMPONENT: L-Shaped Corner Handle
// ------------------------------------------------------------------
interface HandleProps {
    type: InteractionType;
    cursor: string;
    onPointerDown: (e: React.PointerEvent, type: InteractionType) => void;
}

const Handle: React.FC<HandleProps> = ({
    type,
    cursor,
    onPointerDown
}) => {
    // Fixed styling for consistent appearance
    const size = 20;
    const thickness = 2;
    const length = 10;
    const color = 'orange';

    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        width: size,
        height: size,
        cursor: cursor,
        zIndex: 10,
    };
    // ... (skip lines)


    const cornerStyle: React.CSSProperties = {
        position: 'absolute',
        width: '100%',
        height: '100%',
        borderColor: color,
        borderStyle: 'solid',
        borderWidth: 0,
    };

    const isNorth = type.includes('n');
    const isWest = type.includes('w');

    if (isNorth) {
        containerStyle.top = 0;
        cornerStyle.top = 0;
        cornerStyle.borderTopWidth = thickness;
    } else {
        containerStyle.bottom = 0;
        cornerStyle.bottom = 0;
        cornerStyle.borderBottomWidth = thickness;
    }

    if (isWest) {
        containerStyle.left = 0;
        cornerStyle.left = 0;
        cornerStyle.borderLeftWidth = thickness;
    } else {
        containerStyle.right = 0;
        cornerStyle.right = 0;
        cornerStyle.borderRightWidth = thickness;
    }

    cornerStyle.width = length;
    cornerStyle.height = length;

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        >
            <div style={cornerStyle} />
        </div>
    );
};

// ------------------------------------------------------------------
// COMPONENT: Bounding Box with Handles
// ------------------------------------------------------------------
export const BoundingBox: React.FC<BoundingBoxProps> = ({
    rect,
    canvasSize,
    minSize,
    maxBounds,
    maintainAspectRatio = false,
    onDragStart,
    onChange,
    onCommit,
    children,
}) => {
    const boxRef = useRef<HTMLDivElement>(null);
    const startDragRef = useRef<{
        type: InteractionType;
        x: number;
        y: number;
        initialRect: Rect
    } | null>(null);
    const currentRectRef = useRef<Rect>(rect);

    // Sync ref when rect changes
    useEffect(() => {
        currentRectRef.current = rect;
    }, [rect]);

    // Calculate constraints
    const MIN_SIZE = minSize ?? Math.min(canvasSize.width, canvasSize.height) / 5;
    const maxW = maxBounds?.width ?? canvasSize.width;
    const maxH = maxBounds?.height ?? canvasSize.height;
    const aspectRatio = maintainAspectRatio ? rect.width / rect.height : undefined;

    const handlePointerDown = (e: React.PointerEvent, type: InteractionType) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        if (onDragStart) {
            onDragStart();
        }

        startDragRef.current = {
            type,
            x: e.clientX,
            y: e.clientY,
            initialRect: { ...currentRectRef.current }
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!startDragRef.current || !boxRef.current) return;

        const containerRect = boxRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;

        const { type, initialRect, x: startX, y: startY } = startDragRef.current;

        // Calculate scale from screen pixels to canvas coordinates
        const scale = canvasSize.width / containerRect.width;
        const deltaX = (e.clientX - startX) * scale;
        const deltaY = (e.clientY - startY) * scale;

        let newRect = { ...initialRect };

        if (type === 'move') {
            // MOVE: Apply delta and clamp to bounds
            newRect.x += deltaX;
            newRect.y += deltaY;

            // Clamp position
            newRect.x = Math.max(0, Math.min(newRect.x, maxW - newRect.width));
            newRect.y = Math.max(0, Math.min(newRect.y, maxH - newRect.height));
        } else {
            // RESIZE: Handle each corner
            if (maintainAspectRatio && aspectRatio) {
                // Aspect ratio resize logic
                let proposedWidth = initialRect.width;

                if (type === 'se' || type === 'ne') {
                    proposedWidth += deltaX;
                } else { // sw, nw
                    proposedWidth -= deltaX;
                }

                // Apply min size constraint
                proposedWidth = Math.max(MIN_SIZE, proposedWidth);

                // Anchor points for maintaining opposite corner position
                const bottom = initialRect.y + initialRect.height;
                const right = initialRect.x + initialRect.width;

                // Apply bounds constraints based on corner type
                if (type === 'se') {
                    const maxAvailableW = maxW - initialRect.x;
                    const maxAvailableH_asW = (maxH - initialRect.y) * aspectRatio;
                    proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                    newRect.width = proposedWidth;
                    newRect.height = proposedWidth / aspectRatio;
                } else if (type === 'sw') {
                    const maxAvailableW = right;
                    const maxAvailableH_asW = (maxH - initialRect.y) * aspectRatio;
                    proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                    newRect.width = proposedWidth;
                    newRect.height = proposedWidth / aspectRatio;
                    newRect.x = right - newRect.width;
                } else if (type === 'ne') {
                    const maxAvailableW = maxW - initialRect.x;
                    const maxAvailableH_asW = bottom * aspectRatio;
                    proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                    newRect.width = proposedWidth;
                    newRect.height = proposedWidth / aspectRatio;
                    newRect.y = bottom - newRect.height;
                } else if (type === 'nw') {
                    const maxAvailableW = right;
                    const maxAvailableH_asW = bottom * aspectRatio;
                    proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                    newRect.width = proposedWidth;
                    newRect.height = proposedWidth / aspectRatio;
                    newRect.x = right - newRect.width;
                    newRect.y = bottom - newRect.height;
                }
            } else {
                // Free-form resize (no aspect ratio)
                if (type === 'se' || type === 'ne') {
                    newRect.width += deltaX;
                } else { // sw, nw
                    newRect.width -= deltaX;
                    newRect.x += deltaX;
                }

                if (type === 'se' || type === 'sw') {
                    newRect.height += deltaY;
                } else { // ne, nw
                    newRect.height -= deltaY;
                    newRect.y += deltaY;
                }

                // Apply min size constraints
                if (newRect.width < MIN_SIZE) {
                    const diff = MIN_SIZE - newRect.width;
                    newRect.width = MIN_SIZE;
                    if (type === 'sw' || type === 'nw') newRect.x -= diff;
                }
                if (newRect.height < MIN_SIZE) {
                    const diff = MIN_SIZE - newRect.height;
                    newRect.height = MIN_SIZE;
                    if (type === 'ne' || type === 'nw') newRect.y -= diff;
                }

                // Clamp to bounds
                if (newRect.x < 0) {
                    newRect.width += newRect.x;
                    newRect.x = 0;
                }
                if (newRect.y < 0) {
                    newRect.height += newRect.y;
                    newRect.y = 0;
                }
                if (newRect.x + newRect.width > maxW) {
                    newRect.width = maxW - newRect.x;
                }
                if (newRect.y + newRect.height > maxH) {
                    newRect.height = maxH - newRect.y;
                }
            }
        }

        // Update local ref and notify parent
        currentRectRef.current = newRect;
        onChange(newRect);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (startDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit(currentRectRef.current);
            startDragRef.current = null;
        }
    };

    // Convert to percentages for CSS positioning
    const toPct = (val: number, ref: number) => (val / ref) * 100;

    const boxStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${toPct(rect.x, canvasSize.width)}%`,
        top: `${toPct(rect.y, canvasSize.height)}%`,
        width: `${toPct(rect.width, canvasSize.width)}%`,
        height: `${toPct(rect.height, canvasSize.height)}%`,
        cursor: 'move',
        border: '2px solid green',
        boxSizing: 'border-box',
    };

    return (
        <div
            ref={boxRef}
            style={boxStyle}
            onPointerDown={(e) => handlePointerDown(e, 'move')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {children}
            <Handle
                type="nw"
                cursor="nw-resize"
                onPointerDown={handlePointerDown}
            />
            <Handle
                type="ne"
                cursor="ne-resize"
                onPointerDown={handlePointerDown}
            />
            <Handle
                type="sw"
                cursor="sw-resize"
                onPointerDown={handlePointerDown}
            />
            <Handle
                type="se"
                cursor="se-resize"
                onPointerDown={handlePointerDown}
            />
        </div>
    );
};
