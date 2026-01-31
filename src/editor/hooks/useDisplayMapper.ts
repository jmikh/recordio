import { useMemo, useRef } from 'react';
import { DisplayMapper } from '../../core/mappers/displayMapper';
import type { Size } from '../../core/types';

/**
 * Hook to get a memoized DisplayMapper instance for the current output and display sizes.
 * 
 * @param outputSize The logical output resolution (e.g., project.settings.outputSize)
 * @param displaySize The actual rendered size on screen (e.g., from a container ref)
 * @returns A DisplayMapper instance for coordinate conversions
 * 
 * @example
 * const displayMapper = useDisplayMapper(
 *   project.settings.outputSize,
 *   { width: containerRef.current?.clientWidth ?? 0, height: containerRef.current?.clientHeight ?? 0 }
 * );
 * 
 * // Convert output rect to display
 * const displayRect = displayMapper.outputToDisplay(spotlightRect);
 * 
 * // Get CSS positioning
 * const cssStyle = displayMapper.outputToPercentCSS(rect);
 */
export const useDisplayMapper = (outputSize: Size, displaySize: Size): DisplayMapper => {
    // Cache previous instance to avoid unnecessary recreations
    const prevRef = useRef<{ output: Size; display: Size; mapper: DisplayMapper } | null>(null);

    return useMemo(() => {
        // Check if sizes match previous
        if (
            prevRef.current &&
            prevRef.current.output.width === outputSize.width &&
            prevRef.current.output.height === outputSize.height &&
            prevRef.current.display.width === displaySize.width &&
            prevRef.current.display.height === displaySize.height
        ) {
            return prevRef.current.mapper;
        }

        // Create new mapper
        const mapper = new DisplayMapper(outputSize, displaySize);
        prevRef.current = { output: outputSize, display: displaySize, mapper };
        return mapper;
    }, [outputSize.width, outputSize.height, displaySize.width, displaySize.height]);
};

/**
 * Factory function to create a DisplayMapper without React hooks.
 * Useful in non-component contexts.
 */
export const createDisplayMapper = (outputSize: Size, displaySize: Size): DisplayMapper => {
    return new DisplayMapper(outputSize, displaySize);
};
