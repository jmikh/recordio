import { useCallback } from 'react';
import type { Rect } from '../../../../types';
import type { InteractionType, ConstraintEdges, ResizeDirection } from './types';

interface UseResizeLogicProps {
    /** Minimum allowed size for width/height */
    minSize: number;
    /** Maximum allowed size for width/height (independent of position) */
    maxSize?: { width: number; height: number };
    /** Constraint boundaries */
    constraints: ConstraintEdges;
    /** Fixed aspect ratio (width/height) - if null/undefined, free-form resizing is allowed */
    fixedAspectRatio?: number | null;
}

/**
 * Analyzes an interaction type and returns which edges it affects
 */
export function getResizeDirection(type: InteractionType): ResizeDirection {
    const isCorner = ['nw', 'ne', 'sw', 'se'].includes(type);
    const isEdge = ['n', 's', 'e', 'w'].includes(type);

    return {
        affectsLeft: type.includes('w'),
        affectsRight: type.includes('e'),
        affectsTop: type.includes('n'),
        affectsBottom: type.includes('s'),
        isCorner,
        isEdge,
    };
}

/**
 * Hook that encapsulates all resize logic for the BoundingBox.
 * Handles aspect ratio locking, min/max aspect ratio constraints,
 * and boundary clamping.
 */
export function useResizeLogic({
    minSize,
    maxSize,
    constraints,
    fixedAspectRatio,
}: UseResizeLogicProps) {
    const { minX, minY, maxX, maxY, maxW, maxH } = constraints;

    /**
     * Calculate new rect after resize with aspect ratio lock
     */
    const resizeWithAspectLock = useCallback((
        type: InteractionType,
        initialRect: Rect,
        deltaX: number,
        _deltaY: number,
        aspectRatio: number,
    ): Rect => {
        // Calculate proposed width based on direction
        let proposedWidth = initialRect.width;
        if (type === 'se' || type === 'ne') {
            proposedWidth += deltaX;
        } else { // sw, nw
            proposedWidth -= deltaX;
        }

        // Apply minimum size constraint
        proposedWidth = Math.max(minSize, proposedWidth);

        // Apply maximum size constraint (position-independent)
        if (maxSize) {
            const maxWidthFromW = maxSize.width;
            const maxWidthFromH = maxSize.height * aspectRatio;
            proposedWidth = Math.min(proposedWidth, maxWidthFromW, maxWidthFromH);
        }

        // Anchor points for maintaining opposite corner position
        const bottom = initialRect.y + initialRect.height;
        const right = initialRect.x + initialRect.width;

        const newRect = { ...initialRect };

        // Apply bounds constraints and calculate new rect based on corner type
        // Use absolute edge positions (maxX/maxY/minX/minY) for correct clamping
        // when constraint bounds have non-zero origin.
        switch (type) {
            case 'se': {
                const maxAvailableW = maxX - initialRect.x;
                const maxAvailableH_asW = (maxY - initialRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                break;
            }
            case 'sw': {
                const maxAvailableW = right - minX;
                const maxAvailableH_asW = (maxY - initialRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;
                break;
            }
            case 'ne': {
                const maxAvailableW = maxX - initialRect.x;
                const maxAvailableH_asW = (bottom - minY) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.y = bottom - newRect.height;
                break;
            }
            case 'nw': {
                const maxAvailableW = right - minX;
                const maxAvailableH_asW = (bottom - minY) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;
                newRect.y = bottom - newRect.height;
                break;
            }
        }

        return newRect;
    }, [minSize, maxSize, minX, minY, maxX, maxY]);

    /**
     * Calculate new rect after free-form resize (no aspect ratio lock)
     */
    const resizeFreeForm = useCallback((
        type: InteractionType,
        initialRect: Rect,
        deltaX: number,
        deltaY: number,
    ): Rect => {
        const newRect = { ...initialRect };
        const direction = getResizeDirection(type);

        // Store anchor for constraint adjustments
        const right = initialRect.x + initialRect.width;

        // Apply horizontal resize
        if (direction.affectsRight) {
            newRect.width += deltaX;
        } else if (direction.affectsLeft) {
            newRect.width -= deltaX;
            newRect.x += deltaX;
        }

        // Apply vertical resize
        if (direction.affectsBottom) {
            newRect.height += deltaY;
        } else if (direction.affectsTop) {
            newRect.height -= deltaY;
            newRect.y += deltaY;
        }

        // Apply minimum size constraints with anchor correction
        if (newRect.width < minSize) {
            const diff = minSize - newRect.width;
            newRect.width = minSize;
            if (direction.affectsLeft) newRect.x -= diff;
        }
        if (newRect.height < minSize) {
            const diff = minSize - newRect.height;
            newRect.height = minSize;
            if (direction.affectsTop) newRect.y -= diff;
        }

        // Apply maximum size constraints (position-independent)
        if (maxSize) {
            if (newRect.width > maxSize.width) {
                const diff = newRect.width - maxSize.width;
                newRect.width = maxSize.width;
                if (direction.affectsLeft) newRect.x += diff;
            }
            if (newRect.height > maxSize.height) {
                const diff = newRect.height - maxSize.height;
                newRect.height = maxSize.height;
                if (direction.affectsTop) newRect.y += diff;
            }
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

        return newRect;
    }, [minSize, maxSize, minX, minY, maxX, maxY]);

    /**
     * Upgrade an edge interaction to the nearest corner for aspect-ratio-locked resize.
     * Picks the corner based on which quadrant the delta points toward.
     */
    const edgeToCorner = useCallback((
        type: InteractionType,
        deltaX: number,
        deltaY: number,
    ): InteractionType => {
        switch (type) {
            case 'n': return deltaX >= 0 ? 'ne' : 'nw';
            case 's': return deltaX >= 0 ? 'se' : 'sw';
            case 'e': return deltaY >= 0 ? 'se' : 'ne';
            case 'w': return deltaY >= 0 ? 'sw' : 'nw';
            default: return type;
        }
    }, []);

    /**
     * Main resize function - dispatches to appropriate handler.
     * @param shiftAspectRatio - When shift is held, the initial aspect ratio to lock to.
     *                           Only used when fixedAspectRatio is null.
     */
    const calculateResize = useCallback((
        type: InteractionType,
        initialRect: Rect,
        deltaX: number,
        deltaY: number,
        shiftAspectRatio?: number | null,
    ): Rect => {
        if (fixedAspectRatio) {
            return resizeWithAspectLock(type, initialRect, deltaX, deltaY, fixedAspectRatio);
        }
        if (shiftAspectRatio) {
            // Upgrade edge drags to corner drags so aspect lock works
            const effectiveType = getResizeDirection(type).isEdge
                ? edgeToCorner(type, deltaX, deltaY)
                : type;
            return resizeWithAspectLock(effectiveType, initialRect, deltaX, deltaY, shiftAspectRatio);
        }
        return resizeFreeForm(type, initialRect, deltaX, deltaY);
    }, [fixedAspectRatio, resizeWithAspectLock, resizeFreeForm, edgeToCorner]);

    return {
        calculateResize,
        getResizeDirection,
    };
}
