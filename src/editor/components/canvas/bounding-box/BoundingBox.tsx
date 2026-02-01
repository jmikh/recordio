import React, { useRef, useState, useMemo, useCallback } from 'react';
import type { Rect, CornerRadii, InteractionType, CornerIndex, ConstraintEdges, DragState } from './types';
import { useDisplayMapper } from '../../../hooks/useDisplayMapper';
import { useResizeLogic } from './useResizeLogic';
import { useMoveLogic } from './useMoveLogic';
import { useInteractionLock } from './useInteractionLock';
import { Handle, EdgeHandle } from './Handles';
import { CornerRadiusHandle } from './CornerRadiusHandle';
import { LinkToggle } from './LinkToggle';
import {
    BOX_BORDER_WIDTH,
    OVERLAY_BORDER_WIDTH,
    Z_INDEX_BOUNDING_BOX,
    Z_INDEX_RADIUS_HANDLE,
    PRIMARY_COLOR,
} from './constants';

// Re-export types for backwards compatibility
export type { InteractionType, CornerIndex, CornerRadii };

// ------------------------------------------------------------------
// PROPS
// ------------------------------------------------------------------

export interface BoundingBoxProps {
    /** Current rectangle in output coordinates */
    rect: Rect;
    /** Minimum size constraint (default: outputSize / 5) */
    minSize?: number;
    /** Maximum bounds for the rectangle (default: outputSize) */
    maxBounds?: { width: number; height: number };
    /** Constraint bounds - the rectangle must stay within this area (in output coordinates) */
    constraintBounds?: Rect;
    /** Whether to maintain aspect ratio during resize */
    maintainAspectRatio?: boolean;
    /** Minimum aspect ratio (width/height) allowed during free-form resize */
    minAspectRatio?: number;
    /** Maximum aspect ratio (width/height) allowed during free-form resize */
    maxAspectRatio?: number;
    /** Callback when drag starts */
    onDragStart?: () => void;
    /** Callback when rect changes during drag */
    onChange: (rect: Rect) => void;
    /** Callback when drag ends */
    onCommit: (rect: Rect) => void;
    /** Optional children to render inside the box */
    children?: React.ReactNode;

    // ---- Corner Radius Editing ----
    /** Enable corner radius editing with draggable handles */
    allowCornerEditing?: boolean;
    /** Per-corner border radius [tl, tr, br, bl] in output pixels */
    cornerRadii?: CornerRadii;
    /** Whether corners are linked (edit all together). Default: true */
    cornersLinked?: boolean;
    /** Hide the link/unlink toggle */
    hideLinkToggle?: boolean;
    /** Callback when corner radii change during drag */
    onCornerRadiiChange?: (radii: CornerRadii) => void;
    /** Callback when corner radii editing is committed */
    onCornerRadiiCommit?: (radii: CornerRadii) => void;
    /** Callback when corners linked/unlinked toggle changes */
    onCornersLinkedChange?: (linked: boolean) => void;
}

// ------------------------------------------------------------------
// COMPONENT
// ------------------------------------------------------------------

export const BoundingBox: React.FC<BoundingBoxProps> = ({
    rect,
    minSize,
    maxBounds,
    constraintBounds,
    maintainAspectRatio = false,
    minAspectRatio,
    maxAspectRatio,
    onDragStart,
    onChange,
    onCommit,
    children,
    // Corner radius props
    allowCornerEditing = false,
    cornerRadii,
    cornersLinked: controlledLinked,
    hideLinkToggle = false,
    onCornerRadiiChange,
    onCornerRadiiCommit,
    onCornersLinkedChange,
}) => {
    // ------------------------------------------------------------------
    // COORDINATE MAPPING
    // ------------------------------------------------------------------
    const displayMapper = useDisplayMapper();
    const outputSize = displayMapper.outputSize;

    // ------------------------------------------------------------------
    // CONSTRAINTS (memoized for stability)
    // ------------------------------------------------------------------
    const constraints = useMemo<ConstraintEdges>(() => {
        const bounds = constraintBounds ?? {
            x: 0,
            y: 0,
            width: maxBounds?.width ?? outputSize.width,
            height: maxBounds?.height ?? outputSize.height
        };
        return {
            minX: bounds.x,
            minY: bounds.y,
            maxX: bounds.x + bounds.width,
            maxY: bounds.y + bounds.height,
            maxW: bounds.width,
            maxH: bounds.height,
        };
    }, [constraintBounds, maxBounds, outputSize]);

    const MIN_SIZE = minSize ?? Math.min(outputSize.width, outputSize.height) / 5;
    const aspectRatio = maintainAspectRatio ? rect.width / rect.height : undefined;

    // ------------------------------------------------------------------
    // LOGIC HOOKS
    // ------------------------------------------------------------------
    const { calculateResize } = useResizeLogic({
        minSize: MIN_SIZE,
        constraints,
        maintainAspectRatio,
        aspectRatio,
        minAspectRatio,
        maxAspectRatio,
    });

    const { calculateMove } = useMoveLogic({ constraints });
    const { lockInteraction, unlockInteraction } = useInteractionLock();

    // ------------------------------------------------------------------
    // LOCAL STATE
    // Props are initial values only - BoundingBox owns state while active
    // ------------------------------------------------------------------
    const boxRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const currentRectRef = useRef<Rect>(rect);

    // Corner radii state (initialized from props, owned locally during editing)
    const [localCornerRadii, setLocalCornerRadii] = useState<CornerRadii>(
        cornerRadii ?? [0, 0, 0, 0]
    );
    const [internalLinked, setInternalLinked] = useState(true);
    const isLinked = controlledLinked ?? internalLinked;

    // Hover state for showing/hiding radius handles
    const [isHovered, setIsHovered] = useState(false);

    // Keep rect ref in sync (needed for move/resize calculations)
    // This is not prop-sync, just keeping ref current with latest rect value
    currentRectRef.current = rect;

    // ------------------------------------------------------------------
    // MOVE/RESIZE HANDLERS
    // ------------------------------------------------------------------
    const handlePointerDown = useCallback((e: React.PointerEvent, type: InteractionType) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        lockInteraction();
        onDragStart?.();

        dragRef.current = {
            type,
            startX: e.clientX,
            startY: e.clientY,
            initialRect: { ...currentRectRef.current }
        };
    }, [lockInteraction, onDragStart]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragRef.current || !boxRef.current) return;

        const { type, initialRect, startX, startY } = dragRef.current;

        // Convert screen delta to output coordinates
        const scale = displayMapper.displayToOutputLength(1);
        const deltaX = (e.clientX - startX) * scale;
        const deltaY = (e.clientY - startY) * scale;

        let newRect: Rect;
        if (type === 'move') {
            newRect = calculateMove(initialRect, deltaX, deltaY);
        } else {
            newRect = calculateResize(type, initialRect, deltaX, deltaY);
        }

        currentRectRef.current = newRect;
        onChange(newRect);
    }, [displayMapper, calculateMove, calculateResize, onChange]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        if (dragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit(currentRectRef.current);
            dragRef.current = null;
            unlockInteraction();
        }
    }, [onCommit, unlockInteraction]);

    // ------------------------------------------------------------------
    // CORNER RADIUS HANDLERS
    // ------------------------------------------------------------------
    const handleCornerRadiusChange = useCallback((corner: CornerIndex, newRadius: number) => {
        let newRadii: CornerRadii;

        if (isLinked) {
            // When linked, all corners get the same value
            newRadii = [newRadius, newRadius, newRadius, newRadius];
        } else {
            // When unlinked, only update the specific corner
            newRadii = [...localCornerRadii] as CornerRadii;
            newRadii[corner] = newRadius;
        }

        setLocalCornerRadii(newRadii);
        onCornerRadiiChange?.(newRadii);
    }, [isLinked, localCornerRadii, onCornerRadiiChange]);

    const handleCornerRadiusCommit = useCallback(() => {
        onCornerRadiiCommit?.(localCornerRadii);
    }, [localCornerRadii, onCornerRadiiCommit]);

    const handleCornerRadiusDragStart = useCallback(() => {
        lockInteraction();
        onDragStart?.();
    }, [lockInteraction, onDragStart]);

    const handleLinkedToggle = useCallback((linked: boolean) => {
        if (onCornersLinkedChange) {
            onCornersLinkedChange(linked);
        } else {
            setInternalLinked(linked);
        }

        // When linking, unify all corners to the max value
        if (linked) {
            const maxRadius = Math.max(...localCornerRadii);
            const unifiedRadii: CornerRadii = [maxRadius, maxRadius, maxRadius, maxRadius];
            setLocalCornerRadii(unifiedRadii);
            onCornerRadiiChange?.(unifiedRadii);
        }
    }, [onCornersLinkedChange, localCornerRadii, onCornerRadiiChange]);

    // ------------------------------------------------------------------
    // STYLING
    // ------------------------------------------------------------------

    // Border radius CSS calculation
    const borderRadiusCss = useMemo(() => {
        if (allowCornerEditing && localCornerRadii.some(r => r > 0)) {
            const smallerDimension = Math.min(rect.width, rect.height);
            const maxRadius = smallerDimension / 2;

            const clampedRadii: CornerRadii = [
                Math.min(localCornerRadii[0], maxRadius),
                Math.min(localCornerRadii[1], maxRadius),
                Math.min(localCornerRadii[2], maxRadius),
                Math.min(localCornerRadii[3], maxRadius)
            ];
            const displayRadii = displayMapper.outputToDisplayRadii(clampedRadii);

            return `${displayRadii[0]}px ${displayRadii[1]}px ${displayRadii[2]}px ${displayRadii[3]}px`;
        }
        return '0';
    }, [allowCornerEditing, localCornerRadii, rect.width, rect.height, displayMapper]);

    // Convert rect from output to display pixels
    const displayRect = displayMapper.outputToDisplay(rect);

    const boxStyle: React.CSSProperties = {
        position: 'absolute',
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
        cursor: 'move',
        boxSizing: 'border-box',
        borderRadius: borderRadiusCss,
        pointerEvents: 'auto',
        zIndex: Z_INDEX_BOUNDING_BOX,
        border: `${BOX_BORDER_WIDTH}px solid ${PRIMARY_COLOR}`,
    };

    const straightLineStyle: React.CSSProperties = {
        position: 'absolute',
        inset: -1,
        border: `${OVERLAY_BORDER_WIDTH}px solid ${PRIMARY_COLOR}`,
        borderRadius: 0,
        pointerEvents: 'none',
    };

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    return (
        <div
            id="bounding-box"
            ref={boxRef}
            style={boxStyle}
            onPointerDown={(e) => handlePointerDown(e, 'move')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Straight line border overlay */}
            <div style={straightLineStyle} />

            {children}

            {/* Floating Link Toggle Toolbar */}
            {allowCornerEditing && !hideLinkToggle && (
                <div
                    style={{
                        position: 'absolute',
                        top: '-32px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: Z_INDEX_RADIUS_HANDLE,
                        pointerEvents: 'auto',
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <LinkToggle linked={isLinked} onToggle={handleLinkedToggle} />
                </div>
            )}

            {/* Corner Radius Handles - only show on hover */}
            {allowCornerEditing && isHovered && (
                <>
                    {([0, 1, 2, 3] as CornerIndex[]).map((corner) => (
                        <CornerRadiusHandle
                            key={corner}
                            corner={corner}
                            radius={localCornerRadii[corner]}
                            rect={rect}
                            onRadiusChange={handleCornerRadiusChange}
                            onRadiusCommit={handleCornerRadiusCommit}
                            onDragStart={handleCornerRadiusDragStart}
                        />
                    ))}
                </>
            )}

            {/* Corner Resize Handles */}
            <Handle type="nw" cursor="nw-resize" onPointerDown={handlePointerDown} />
            <Handle type="ne" cursor="ne-resize" onPointerDown={handlePointerDown} />
            <Handle type="sw" cursor="sw-resize" onPointerDown={handlePointerDown} />
            <Handle type="se" cursor="se-resize" onPointerDown={handlePointerDown} />

            {/* Edge Resize Handles (only when aspect ratio not locked) */}
            {!maintainAspectRatio && (
                <>
                    <EdgeHandle type="n" cursor="n-resize" onPointerDown={handlePointerDown} />
                    <EdgeHandle type="s" cursor="s-resize" onPointerDown={handlePointerDown} />
                    <EdgeHandle type="w" cursor="w-resize" onPointerDown={handlePointerDown} />
                    <EdgeHandle type="e" cursor="e-resize" onPointerDown={handlePointerDown} />
                </>
            )}
        </div>
    );
};
