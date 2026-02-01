import { useRef, useCallback } from 'react';

/**
 * Interaction Lock Hook
 * 
 * Implements the "Interaction-Locked Pattern" to prevent race conditions
 * during drag operations. When a drag is in progress, prop synchronization
 * is blocked to avoid visual "jumping" or "rebounds" caused by async store updates.
 * 
 * Usage:
 * 1. Call `lockInteraction()` in onDragStart/onPointerDown
 * 2. Use `isLocked()` in useEffect to conditionally skip prop sync
 * 3. Call `unlockInteraction()` in onCommit/onPointerUp (uses rAF for atomic release)
 */
export function useInteractionLock() {
    const isInteractingRef = useRef(false);

    /**
     * Check if an interaction is currently in progress
     */
    const isLocked = useCallback(() => isInteractingRef.current, []);

    /**
     * Lock interaction at the start of a drag
     */
    const lockInteraction = useCallback(() => {
        isInteractingRef.current = true;
    }, []);

    /**
     * Unlock interaction after commit.
     * Uses requestAnimationFrame to ensure the store update has propagated
     * before allowing prop sync to resume (prevents first-interaction rebound bug).
     */
    const unlockInteraction = useCallback(() => {
        requestAnimationFrame(() => {
            isInteractingRef.current = false;
        });
    }, []);

    /**
     * Immediate unlock (for error cases or when rAF delay is not needed)
     */
    const forceUnlock = useCallback(() => {
        isInteractingRef.current = false;
    }, []);

    return {
        isLocked,
        lockInteraction,
        unlockInteraction,
        forceUnlock,
    };
}
