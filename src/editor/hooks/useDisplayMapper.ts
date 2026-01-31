import { DisplayMapper } from '../../core/mappers/displayMapper';
import type { Size } from '../../core/types';
import { useProjectStore } from '../stores/useProjectStore';
import { useUIStore } from '../stores/useUIStore';

// Module-level cache (similar to useTimeMapper pattern)
let lastOutputSize: Size | null = null;
let lastDisplaySize: Size | null = null;
let lastDisplayMapper: DisplayMapper | null = null;

/**
 * Get a memoized DisplayMapper instance for the given sizes.
 * Uses module-level caching to avoid unnecessary recreations.
 */
export const getDisplayMapper = (outputSize: Size, displaySize: Size): DisplayMapper => {
    // If sizes match and we have a cached instance, reuse it
    if (
        lastOutputSize &&
        lastDisplaySize &&
        lastDisplayMapper &&
        lastOutputSize.width === outputSize.width &&
        lastOutputSize.height === outputSize.height &&
        lastDisplaySize.width === displaySize.width &&
        lastDisplaySize.height === displaySize.height
    ) {
        return lastDisplayMapper;
    }

    // Create new instance and cache it
    lastOutputSize = outputSize;
    lastDisplaySize = displaySize;
    lastDisplayMapper = new DisplayMapper(outputSize, displaySize);
    return lastDisplayMapper;
};

/**
 * Hook to get a DisplayMapper instance for coordinate conversions.
 * 
 * Gets outputSize from the project store and displaySize (canvasContainerSize) 
 * from the UI store. This allows any component to get the mapper without 
 * needing to pass sizes as props.
 * 
 * NOTE: The canvas container must set its size via setCanvasContainerSize
 * for this hook to return accurate mappings.
 * 
 * @returns A DisplayMapper instance for coordinate conversions
 * 
 * @example
 * const displayMapper = useDisplayMapper();
 * 
 * // Convert output rect to display
 * const displayRect = displayMapper.outputToDisplay(spotlightRect);
 * 
 * // Get sizes if needed
 * const { outputSize, displaySize } = displayMapper;
 */
export const useDisplayMapper = (): DisplayMapper => {
    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const displaySize = useUIStore(s => s.canvasContainerSize);

    return getDisplayMapper(outputSize, displaySize);
};
