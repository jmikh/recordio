import { useCallback } from 'react';
import type { Rect } from '../../../../core/types';
import type { ConstraintEdges } from './types';

interface UseMoveLogicProps {
    /** Constraint boundaries */
    constraints: ConstraintEdges;
}

/**
 * Hook that encapsulates move logic for the BoundingBox.
 * Handles boundary clamping during move operations.
 */
export function useMoveLogic({ constraints }: UseMoveLogicProps) {
    const { minX, minY, maxX, maxY } = constraints;

    /**
     * Calculate new rect position after move, clamped to constraints
     */
    const calculateMove = useCallback((
        initialRect: Rect,
        deltaX: number,
        deltaY: number,
    ): Rect => {
        const newRect = { ...initialRect };

        // Apply delta
        newRect.x += deltaX;
        newRect.y += deltaY;

        // Clamp position to constraint bounds
        newRect.x = Math.max(minX, Math.min(newRect.x, maxX - newRect.width));
        newRect.y = Math.max(minY, Math.min(newRect.y, maxY - newRect.height));

        return newRect;
    }, [minX, minY, maxX, maxY]);

    return {
        calculateMove,
    };
}
