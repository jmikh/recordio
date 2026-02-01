import type { Rect } from '../../../../core/types';
import type { CornerRadii } from '../../../../core/mappers/displayMapper';

// ------------------------------------------------------------------
// INTERACTION TYPES
// ------------------------------------------------------------------

/** All possible interaction modes for the bounding box */
export type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

/** Corner indices: 0=topLeft, 1=topRight, 2=bottomRight, 3=bottomLeft */
export type CornerIndex = 0 | 1 | 2 | 3;

/** Resize direction analysis */
export interface ResizeDirection {
    /** Affects left edge (moves x position) */
    affectsLeft: boolean;
    /** Affects right edge (changes width rightward) */
    affectsRight: boolean;
    /** Affects top edge (moves y position) */
    affectsTop: boolean;
    /** Affects bottom edge (changes height downward) */
    affectsBottom: boolean;
    /** Is a corner resize (affects both dimensions) */
    isCorner: boolean;
    /** Is an edge resize (affects only one dimension) */
    isEdge: boolean;
}

// ------------------------------------------------------------------
// CONSTRAINT TYPES
// ------------------------------------------------------------------

/** Bounds that the rectangle must stay within */
export interface ConstraintBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Computed constraint edges for quick clamping */
export interface ConstraintEdges {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    maxW: number;
    maxH: number;
}

// ------------------------------------------------------------------
// DRAG STATE
// ------------------------------------------------------------------

/** State captured at the start of a drag operation */
export interface DragState {
    type: InteractionType;
    startX: number;
    startY: number;
    initialRect: Rect;
}

// Re-export for convenience
export type { Rect, CornerRadii };
