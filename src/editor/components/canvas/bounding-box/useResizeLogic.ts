import { useCallback } from 'react';
import type { Rect } from '../../../../core/types';
import type { InteractionType, ConstraintEdges, ResizeDirection } from './types';

interface UseResizeLogicProps {
    /** Minimum allowed size for width/height */
    minSize: number;
    /** Constraint boundaries */
    constraints: ConstraintEdges;
    /** If true, maintain initial aspect ratio during resize */
    maintainAspectRatio: boolean;
    /** Initial aspect ratio (width/height), required when maintainAspectRatio is true */
    aspectRatio?: number;
    /** Minimum aspect ratio constraint (width/height) */
    minAspectRatio?: number;
    /** Maximum aspect ratio constraint (width/height) */
    maxAspectRatio?: number;
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
    constraints,
    maintainAspectRatio,
    aspectRatio,
    minAspectRatio,
    maxAspectRatio,
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
    ): Rect => {
        if (!aspectRatio) {
            throw new Error('aspectRatio required for locked resize');
        }

        // Calculate proposed width based on direction
        let proposedWidth = initialRect.width;
        if (type === 'se' || type === 'ne') {
            proposedWidth += deltaX;
        } else { // sw, nw
            proposedWidth -= deltaX;
        }

        // Apply minimum size constraint
        proposedWidth = Math.max(minSize, proposedWidth);

        // Anchor points for maintaining opposite corner position
        const bottom = initialRect.y + initialRect.height;
        const right = initialRect.x + initialRect.width;

        const newRect = { ...initialRect };

        // Apply bounds constraints and calculate new rect based on corner type
        switch (type) {
            case 'se': {
                const maxAvailableW = maxW - initialRect.x;
                const maxAvailableH_asW = (maxH - initialRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                break;
            }
            case 'sw': {
                const maxAvailableW = right;
                const maxAvailableH_asW = (maxH - initialRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;
                break;
            }
            case 'ne': {
                const maxAvailableW = maxW - initialRect.x;
                const maxAvailableH_asW = bottom * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.y = bottom - newRect.height;
                break;
            }
            case 'nw': {
                const maxAvailableW = right;
                const maxAvailableH_asW = bottom * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);
                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;
                newRect.y = bottom - newRect.height;
                break;
            }
        }

        return newRect;
    }, [aspectRatio, minSize, maxW, maxH]);

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

        // Apply min/max aspect ratio constraints
        const currentAspect = newRect.width / newRect.height;

        if (minAspectRatio !== undefined && currentAspect < minAspectRatio) {
            const targetWidth = newRect.height * minAspectRatio;
            if (direction.affectsLeft) {
                newRect.x = right - targetWidth;
            }
            newRect.width = targetWidth;
        }

        if (maxAspectRatio !== undefined && currentAspect > maxAspectRatio) {
            const targetWidth = newRect.height * maxAspectRatio;
            if (direction.affectsLeft) {
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

        return newRect;
    }, [minSize, minAspectRatio, maxAspectRatio, minX, minY, maxX, maxY]);

    /**
     * Main resize function - dispatches to appropriate handler
     */
    const calculateResize = useCallback((
        type: InteractionType,
        initialRect: Rect,
        deltaX: number,
        deltaY: number,
    ): Rect => {
        if (maintainAspectRatio && aspectRatio) {
            return resizeWithAspectLock(type, initialRect, deltaX, deltaY);
        }
        return resizeFreeForm(type, initialRect, deltaX, deltaY);
    }, [maintainAspectRatio, aspectRatio, resizeWithAspectLock, resizeFreeForm]);

    return {
        calculateResize,
        getResizeDirection,
    };
}
