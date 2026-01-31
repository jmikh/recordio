import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Rect } from '../../../core/types';
import type { CornerRadii } from '../../../core/mappers/displayMapper';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
export type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

/** Corner indices: 0=topLeft, 1=topRight, 2=bottomRight, 3=bottomLeft */
export type CornerIndex = 0 | 1 | 2 | 3;

// Re-export CornerRadii for consumers
export type { CornerRadii };

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
    /** Minimum aspect ratio (width/height) allowed during free-form resize. E.g., 0.5 = can be 2x taller than wide */
    minAspectRatio?: number;
    /** Maximum aspect ratio (width/height) allowed during free-form resize. E.g., 2.0 = can be 2x wider than tall */
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
    /** 
     * Per-corner border radius [tl, tr, br, bl] in output pixels.
     * Clamped to half of smaller dimension during rendering.
     */
    cornerRadii?: CornerRadii;
    /** Whether corners are linked (edit all together). Default: true */
    cornersLinked?: boolean;
    /** Hide the link/unlink toggle (use when corners are always linked) */
    hideLinkToggle?: boolean;
    /** Callback when corner radii change during drag */
    onCornerRadiiChange?: (radii: CornerRadii) => void;
    /** Callback when corner radii editing is committed */
    onCornerRadiiCommit?: (radii: CornerRadii) => void;
    /** Callback when corners linked/unlinked toggle changes */
    onCornersLinkedChange?: (linked: boolean) => void;
}

// ------------------------------------------------------------------
// COMPONENT: Square Corner Handle
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
    const size = 10;
    const color = 'var(--primary)';
    const borderColor = 'white';

    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        width: size,
        height: size,
        backgroundColor: color,
        border: `1.5px solid ${borderColor}`,
        cursor: cursor,
        zIndex: 10,
        boxSizing: 'border-box',
    };

    // Position based on corner type
    const isNorth = type.includes('n');
    const isWest = type.includes('w');

    if (isNorth) {
        containerStyle.top = -size / 2;
    } else {
        containerStyle.bottom = -size / 2;
    }

    if (isWest) {
        containerStyle.left = -size / 2;
    } else {
        containerStyle.right = -size / 2;
    }

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        />
    );
};

// ------------------------------------------------------------------
// COMPONENT: Invisible Edge Handle (full edge hit area)
// ------------------------------------------------------------------
const EdgeHandle: React.FC<HandleProps> = ({
    type,
    cursor,
    onPointerDown
}) => {
    const hitAreaWidth = 8; // Width of the invisible hit area

    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        cursor: cursor,
        zIndex: 5, // Below corner handles
        background: 'transparent',
    };

    // Each edge handle spans the full length minus corners
    const cornerOffset = 10; // Space for corner handles

    switch (type) {
        case 'n':
            containerStyle.top = -hitAreaWidth / 2;
            containerStyle.left = cornerOffset;
            containerStyle.right = cornerOffset;
            containerStyle.height = hitAreaWidth;
            break;
        case 's':
            containerStyle.bottom = -hitAreaWidth / 2;
            containerStyle.left = cornerOffset;
            containerStyle.right = cornerOffset;
            containerStyle.height = hitAreaWidth;
            break;
        case 'w':
            containerStyle.left = -hitAreaWidth / 2;
            containerStyle.top = cornerOffset;
            containerStyle.bottom = cornerOffset;
            containerStyle.width = hitAreaWidth;
            break;
        case 'e':
            containerStyle.right = -hitAreaWidth / 2;
            containerStyle.top = cornerOffset;
            containerStyle.bottom = cornerOffset;
            containerStyle.width = hitAreaWidth;
            break;
    }

    return (
        <div
            style={containerStyle}
            onPointerDown={(e) => onPointerDown(e, type)}
        />
    );
};

// ------------------------------------------------------------------
// COMPONENT: Corner Radius Drag Handle (Figma-style)
// ------------------------------------------------------------------
interface CornerRadiusHandleProps {
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

const CornerRadiusHandle: React.FC<CornerRadiusHandleProps> = ({
    corner,
    radius,
    rect,
    onRadiusChange,
    onRadiusCommit,
    onDragStart,
}) => {
    const displayMapper = useDisplayMapper();
    const handleSize = 10;
    const minInsetOutput = 48; // Minimum inset from corner in output pixels

    // Calculate max possible radius (half of smaller dimension)
    const smallerDimension = Math.min(rect.width, rect.height);
    const maxRadius = smallerDimension / 2;
    const clampedRadius = Math.min(radius, maxRadius);

    // Calculate handle offset in output pixels, then convert to display pixels
    const effectiveOffsetOutput = Math.max(clampedRadius, minInsetOutput);
    const offsetDisplayX = displayMapper.outputToDisplayLength(effectiveOffsetOutput);
    const offsetDisplayY = displayMapper.outputToDisplayLength(effectiveOffsetOutput);

    // Custom cursor SVGs for corner radius editing - curved arc showing the corner direction
    // Thick black stroke with thin white outline (like system cursors)
    const createCornerCursor = (rotation: number): string => {
        // SVG showing a quarter-circle arc - the curve opens toward the corner (16x16 size)
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
    };

    // Each corner needs a different rotation for the cursor
    const cursorRotations: Record<CornerIndex, number> = {
        0: 0,    // Top-left: no rotation
        1: 90,   // Top-right: 90° clockwise
        2: 180,  // Bottom-right: 180°
        3: 270   // Bottom-left: 270°
    };

    // Position based on corner (in display pixels)
    const cornerStyles: Record<CornerIndex, React.CSSProperties> = {
        0: { top: offsetDisplayY, left: offsetDisplayX, cursor: createCornerCursor(cursorRotations[0]) },
        1: { top: offsetDisplayY, right: offsetDisplayX, cursor: createCornerCursor(cursorRotations[1]) },
        2: { bottom: offsetDisplayY, right: offsetDisplayX, cursor: createCornerCursor(cursorRotations[2]) },
        3: { bottom: offsetDisplayY, left: offsetDisplayX, cursor: createCornerCursor(cursorRotations[3]) }
    };

    const style: React.CSSProperties = {
        position: 'absolute',
        width: handleSize,
        height: handleSize,
        borderRadius: '50%',
        backgroundColor: 'white',
        border: '1px solid var(--primary)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        transform: 'translate(-50%, -50%)',
        zIndex: 110,
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

// ------------------------------------------------------------------
// COMPONENT: Link/Unlink Toggle (Floating above bounding box)
// ------------------------------------------------------------------
interface LinkToggleProps {
    linked: boolean;
    onToggle: (linked: boolean) => void;
}

const LinkToggle: React.FC<LinkToggleProps> = ({ linked, onToggle }) => {
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onToggle(!linked);
            }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded shadow-md border transition-colors ${linked
                ? 'bg-primary/20 border-primary/50 hover:bg-primary/30'
                : 'bg-surface-overlay/90 border-border/50 hover:bg-surface-overlay'
                }`}
            title={linked ? 'Unlink corners (edit independently)' : 'Link corners (edit together)'}
            style={{ pointerEvents: 'auto' }}
        >
            {/* Chain link icon */}
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: linked ? 'var(--primary)' : 'var(--text-muted)' }}
            >
                {linked ? (
                    // Linked chain
                    <>
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </>
                ) : (
                    // Broken chain
                    <>
                        <path d="M9 17H7A5 5 0 0 1 7 7" />
                        <path d="M15 7h2a5 5 0 0 1 4 8" />
                        <line x1="8" y1="12" x2="12" y2="12" />
                    </>
                )}
            </svg>
            <span className={`text-xs ${linked ? 'text-primary' : 'text-text-secondary'}`}>
                {linked ? 'Linked' : 'Unlinked'}
            </span>
        </button>
    );
};

// ------------------------------------------------------------------
// COMPONENT: Bounding Box with Handles
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
    // Corner radius editing props
    allowCornerEditing = false,
    cornerRadii,
    cornersLinked: controlledLinked,
    hideLinkToggle = false,
    onCornerRadiiChange,
    onCornerRadiiCommit,
    onCornersLinkedChange,
}) => {
    // Get DisplayMapper from hook (contains outputSize and displaySize)
    const displayMapper = useDisplayMapper();
    const outputSize = displayMapper.outputSize;

    // Internal state for linked mode (used when not controlled)
    const [internalLinked, setInternalLinked] = useState(true);
    const isLinked = controlledLinked ?? internalLinked;

    // Current corner radii being edited (for responsive updates)
    const [localCornerRadii, setLocalCornerRadii] = useState<CornerRadii>(cornerRadii ?? [0, 0, 0, 0]);

    // Hover state for showing/hiding radius handles
    const [isHovered, setIsHovered] = useState(false);

    // Sync local state when prop changes
    useEffect(() => {
        if (cornerRadii) {
            setLocalCornerRadii(cornerRadii);
        }
    }, [cornerRadii]);

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
    const MIN_SIZE = minSize ?? Math.min(outputSize.width, outputSize.height) / 5;

    // Use constraintBounds if provided, otherwise fall back to maxBounds or outputSize
    const bounds = constraintBounds ?? {
        x: 0,
        y: 0,
        width: maxBounds?.width ?? outputSize.width,
        height: maxBounds?.height ?? outputSize.height
    };
    const minX = bounds.x;
    const minY = bounds.y;
    const maxX = bounds.x + bounds.width;
    const maxY = bounds.y + bounds.height;
    const maxW = bounds.width;
    const maxH = bounds.height;

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

        // Calculate scale from screen pixels to output coordinates using displayMapper
        const scale = displayMapper.displayToOutputLength(1);
        const deltaX = (e.clientX - startX) * scale;
        const deltaY = (e.clientY - startY) * scale;

        let newRect = { ...initialRect };

        if (type === 'move') {
            // MOVE: Apply delta and clamp to constraint bounds
            newRect.x += deltaX;
            newRect.y += deltaY;

            // Clamp position to constraint bounds
            newRect.x = Math.max(minX, Math.min(newRect.x, maxX - newRect.width));
            newRect.y = Math.max(minY, Math.min(newRect.y, maxY - newRect.height));
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
                // Free-form resize (no aspect ratio lock, but may have min/max constraints)

                // Store anchor for constraint adjustments (used when resizing from left side)
                const right = initialRect.x + initialRect.width;

                // Horizontal logic
                if (type === 'se' || type === 'ne' || type === 'e') {
                    newRect.width += deltaX;
                } else if (type === 'sw' || type === 'nw' || type === 'w') {
                    newRect.width -= deltaX;
                    newRect.x += deltaX;
                }

                // Vertical logic
                if (type === 'se' || type === 'sw' || type === 's') {
                    newRect.height += deltaY;
                } else if (type === 'ne' || type === 'nw' || type === 'n') {
                    newRect.height -= deltaY;
                    newRect.y += deltaY;
                }

                // Apply min size constraints
                if (newRect.width < MIN_SIZE) {
                    const diff = MIN_SIZE - newRect.width;
                    newRect.width = MIN_SIZE;
                    if (type === 'sw' || type === 'nw' || type === 'w') newRect.x -= diff;
                }
                if (newRect.height < MIN_SIZE) {
                    const diff = MIN_SIZE - newRect.height;
                    newRect.height = MIN_SIZE;
                    if (type === 'ne' || type === 'nw' || type === 'n') newRect.y -= diff;
                }

                // Apply aspect ratio constraints (min/max)
                const currentAspect = newRect.width / newRect.height;

                if (minAspectRatio !== undefined && currentAspect < minAspectRatio) {
                    // Too narrow - widen or shorten
                    // Adjust width to meet minimum aspect ratio
                    const targetWidth = newRect.height * minAspectRatio;
                    if (type === 'sw' || type === 'nw' || type === 'w') {
                        // Anchored on right, adjust x
                        newRect.x = right - targetWidth;
                    }
                    newRect.width = targetWidth;
                }

                if (maxAspectRatio !== undefined && currentAspect > maxAspectRatio) {
                    // Too wide - narrow or heighten
                    // Adjust width to meet maximum aspect ratio
                    const targetWidth = newRect.height * maxAspectRatio;
                    if (type === 'sw' || type === 'nw' || type === 'w') {
                        // Anchored on right, adjust x
                        newRect.x = right - targetWidth;
                    }
                    newRect.width = targetWidth;
                }

                // Clamp to constraint bounds
                if (newRect.x < minX) {
                    newRect.width += newRect.x - minX;
                    newRect.x = minX;
                }
                if (newRect.y < minY) {
                    newRect.height += newRect.y - minY;
                    newRect.y = minY;
                }
                if (newRect.x + newRect.width > maxX) {
                    newRect.width = maxX - newRect.x;
                }
                if (newRect.y + newRect.height > maxY) {
                    newRect.height = maxY - newRect.y;
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

    // ---- Corner Radius Handlers ----
    const handleCornerRadiusChange = (corner: CornerIndex, newRadius: number) => {
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
    };

    const handleCornerRadiusCommit = () => {
        onCornerRadiiCommit?.(localCornerRadii);
    };

    const handleLinkedToggle = (linked: boolean) => {
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
    };

    // ---- Border Radius CSS Calculation ----
    // Use DisplayMapper to convert output pixels to display pixels
    const borderRadiusCss = useMemo(() => {
        if (allowCornerEditing && localCornerRadii.some(r => r > 0)) {
            const smallerDimension = Math.min(rect.width, rect.height);
            const maxRadius = smallerDimension / 2;

            // Clamp radii to half of smaller dimension, then convert to display pixels
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

    // Main box style - shows rounded corners (all positioning in display pixels)
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
        zIndex: 100,
        border: '1.5px solid var(--primary)',
    };

    // Straight line overlay - keeps corner handles connected
    const straightLineStyle: React.CSSProperties = {
        position: 'absolute',
        inset: -1, // Slightly outside to overlap main border
        border: '1px solid var(--primary)',
        borderRadius: 0,
        pointerEvents: 'none',
    };

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

            {/* Floating Link Toggle Toolbar - positioned above bounding box */}
            {allowCornerEditing && !hideLinkToggle && (
                <div
                    style={{
                        position: 'absolute',
                        top: '-32px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 110,
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
                    <CornerRadiusHandle
                        corner={0}
                        radius={localCornerRadii[0]}
                        rect={rect}
                        onRadiusChange={handleCornerRadiusChange}
                        onRadiusCommit={handleCornerRadiusCommit}
                        onDragStart={onDragStart}
                    />
                    <CornerRadiusHandle
                        corner={1}
                        radius={localCornerRadii[1]}
                        rect={rect}
                        onRadiusChange={handleCornerRadiusChange}
                        onRadiusCommit={handleCornerRadiusCommit}
                        onDragStart={onDragStart}
                    />
                    <CornerRadiusHandle
                        corner={2}
                        radius={localCornerRadii[2]}
                        rect={rect}
                        onRadiusChange={handleCornerRadiusChange}
                        onRadiusCommit={handleCornerRadiusCommit}
                        onDragStart={onDragStart}
                    />
                    <CornerRadiusHandle
                        corner={3}
                        radius={localCornerRadii[3]}
                        rect={rect}
                        onRadiusChange={handleCornerRadiusChange}
                        onRadiusCommit={handleCornerRadiusCommit}
                        onDragStart={onDragStart}
                    />
                </>
            )}

            {/* Resize Handles */}
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
            {!maintainAspectRatio && (
                <>
                    <EdgeHandle
                        type="n"
                        cursor="n-resize"
                        onPointerDown={handlePointerDown}
                    />
                    <EdgeHandle
                        type="s"
                        cursor="s-resize"
                        onPointerDown={handlePointerDown}
                    />
                    <EdgeHandle
                        type="w"
                        cursor="w-resize"
                        onPointerDown={handlePointerDown}
                    />
                    <EdgeHandle
                        type="e"
                        cursor="e-resize"
                        onPointerDown={handlePointerDown}
                    />
                </>
            )}
        </div>
    );
};
