import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Rect } from '../../../core/types';
import { DisplayMapper, type CornerRadii } from '../../../core/displayMapper';

// ------------------------------------------------------------------
// TYPES
// ------------------------------------------------------------------
export type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

/** Corner indices: 0=topLeft, 1=topRight, 2=bottomRight, 3=bottomLeft */
export type CornerIndex = 0 | 1 | 2 | 3;

// Re-export CornerRadii for consumers
export type { CornerRadii };

export interface BoundingBoxProps {
    /** Current rectangle in canvas coordinates */
    rect: Rect;
    /** Canvas dimensions for bounds checking */
    canvasSize: { width: number; height: number };
    /** Minimum size constraint (default: canvasSize / 5) */
    minSize?: number;
    /** Maximum bounds for the rectangle (default: canvasSize) */
    maxBounds?: { width: number; height: number };
    /** Constraint bounds - the rectangle must stay within this area (in canvas coordinates) */
    constraintBounds?: Rect;
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

    // ---- Corner Radius Editing ----
    /** Enable corner radius editing with draggable handles */
    allowCornerEditing?: boolean;
    /** Per-corner border radius [tl, tr, br, bl] in output pixels. Default: [0,0,0,0] */
    cornerRadii?: CornerRadii;
    /** Whether corners are linked (edit all together). Default: true */
    cornersLinked?: boolean;
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
    const handleSize = 10;
    const minInset = 48; // Minimum inset from corner when radius is 0

    // Calculate max possible radius (half of smaller dimension)
    const maxRadius = Math.min(rect.width, rect.height) / 2;

    // Position the handle along the corner radius arc
    // When radius = 0, handle is slightly inside to not interfere with corner handles
    // When radius = max, handle is at arc center
    const clampedRadius = Math.min(radius, maxRadius);

    // Calculate handle offset from corner (as percentage of box)
    // Use max of radius offset or minimum inset
    const effectiveOffset = Math.max(clampedRadius, minInset);
    const offsetPct = (effectiveOffset / rect.width) * 100;
    const offsetPctY = (effectiveOffset / rect.height) * 100;

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
        return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') 8 8, pointer`;
    };

    // Cursor orientations for each corner - curve opens toward the corner being edited
    const cursorMap: Record<CornerIndex, string> = {
        0: createCornerCursor(0),    // Top-left: curve opens toward top-left
        1: createCornerCursor(90),   // Top-right: curve opens toward top-right
        2: createCornerCursor(180),  // Bottom-right: curve opens toward bottom-right
        3: createCornerCursor(270),  // Bottom-left: curve opens toward bottom-left
    };

    // Position based on corner
    const style: React.CSSProperties = {
        position: 'absolute',
        width: handleSize,
        height: handleSize,
        backgroundColor: 'white',
        borderRadius: '50%',
        cursor: cursorMap[corner],
        zIndex: 20,
        transform: 'translate(-50%, -50%)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        border: '1.5px solid var(--primary)',
    };

    // Position handle at the start of the radius curve for each corner
    switch (corner) {
        case 0: // Top-left: handle moves along diagonal
            style.left = `${offsetPct}%`;
            style.top = `${offsetPctY}%`;
            break;
        case 1: // Top-right
            style.right = `${offsetPct}%`;
            style.left = 'auto';
            style.top = `${offsetPctY}%`;
            style.transform = 'translate(50%, -50%)';
            break;
        case 2: // Bottom-right
            style.right = `${offsetPct}%`;
            style.left = 'auto';
            style.bottom = `${offsetPctY}%`;
            style.top = 'auto';
            style.transform = 'translate(50%, 50%)';
            break;
        case 3: // Bottom-left
            style.left = `${offsetPct}%`;
            style.bottom = `${offsetPctY}%`;
            style.top = 'auto';
            style.transform = 'translate(-50%, 50%)';
            break;
    }

    const handlePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onDragStart?.();

        const startX = e.clientX;
        const startY = e.clientY;
        const startRadius = radius;
        const target = e.currentTarget;

        // Get container (bounding box) for scale calculation
        const container = target.parentElement;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();

        // Scale based on the bounding box: output pixels / display pixels
        const scaleX = rect.width / containerRect.width;
        const scaleY = rect.height / containerRect.height;

        const onMove = (moveE: PointerEvent) => {
            // Convert screen movement to output coordinates
            const deltaX = (moveE.clientX - startX) * scaleX;
            const deltaY = (moveE.clientY - startY) * scaleY;

            // Project mouse movement onto the diagonal direction for 1:1 tracking
            // The handle moves along the diagonal, so we project the mouse delta onto (1,1) direction
            const sqrt2 = Math.sqrt(2);
            let radiusDelta = 0;
            switch (corner) {
                case 0: // Top-left: moving right/down increases
                    radiusDelta = (deltaX + deltaY) / sqrt2;
                    break;
                case 1: // Top-right: moving left/down increases
                    radiusDelta = (-deltaX + deltaY) / sqrt2;
                    break;
                case 2: // Bottom-right: moving left/up increases
                    radiusDelta = (-deltaX - deltaY) / sqrt2;
                    break;
                case 3: // Bottom-left: moving right/up increases
                    radiusDelta = (deltaX - deltaY) / sqrt2;
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
    canvasSize,
    minSize,
    maxBounds,
    constraintBounds,
    maintainAspectRatio = false,
    onDragStart,
    onChange,
    onCommit,
    children,
    // Corner radius editing props
    allowCornerEditing = false,
    cornerRadii,
    cornersLinked: controlledLinked,
    onCornerRadiiChange,
    onCornerRadiiCommit,
    onCornersLinkedChange,
}) => {
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
    const MIN_SIZE = minSize ?? Math.min(canvasSize.width, canvasSize.height) / 5;

    // Use constraintBounds if provided, otherwise fall back to maxBounds or canvasSize
    const bounds = constraintBounds ?? {
        x: 0,
        y: 0,
        width: maxBounds?.width ?? canvasSize.width,
        height: maxBounds?.height ?? canvasSize.height
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

        // Calculate scale from screen pixels to canvas coordinates
        const scale = canvasSize.width / containerRect.width;
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
                // Free-form resize (no aspect ratio)

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

    // Create DisplayMapper for coordinate conversions (canvasSize is the output size)
    const displayMapper = useMemo(
        () => new DisplayMapper(canvasSize, canvasSize),
        [canvasSize.width, canvasSize.height]
    );

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
    // Use DisplayMapper for consistent percentage conversion
    const borderRadiusCss = useMemo(() => {
        if (allowCornerEditing && localCornerRadii.some(r => r > 0)) {
            return displayMapper.outputRadiiToPercentCSS(localCornerRadii, rect.width, rect.height);
        }
        return '0';
    }, [allowCornerEditing, localCornerRadii, rect.width, rect.height, displayMapper]);

    // Use DisplayMapper for box positioning
    const positionCss = displayMapper.outputToPercentCSS(rect);

    // Main box style - shows rounded corners
    const boxStyle: React.CSSProperties = {
        position: 'absolute',
        left: positionCss.left,
        top: positionCss.top,
        width: positionCss.width,
        height: positionCss.height,
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
            {allowCornerEditing && (
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
