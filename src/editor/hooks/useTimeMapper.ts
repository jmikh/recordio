
// Helper to get memoized TimeMapper
import { TimeMapper } from '../../core/mappers/timeMapper';
import type { OutputWindow } from '../../core/types';
import { useProjectStore } from '../stores/useProjectStore';

// Module-level cache
let lastWindows: OutputWindow[] | null = null;
let lastTimeMapper: TimeMapper | null = null;

export const getTimeMapper = (windows: OutputWindow[]): TimeMapper => {
    // If windows reference hasn't changed, return cached instance
    if (lastWindows === windows && lastTimeMapper) {
        return lastTimeMapper;
    }

    // Create new instance and cache it
    lastWindows = windows;
    lastTimeMapper = new TimeMapper(windows);
    return lastTimeMapper;
};

export const useTimeMapper = (): TimeMapper => {
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    return getTimeMapper(outputWindows);
};
