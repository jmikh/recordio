import { useMemo } from 'react';
import { getAllFocusAreas, type FocusArea } from '../../core/focusManager';
import { useProjectStore, useProjectSources } from '../stores/useProjectStore';
import { useTimeMapper } from './useTimeMapper';

/**
 * Hook that returns cached focus areas for the current project.
 * Recomputes only when timeMapper (outputWindows) or userEvents change.
 */
// TODO: only recompute if auto zoom is true and we are not displaying debug focus areas.
export function useFocusAreas(): FocusArea[] {
    const timeMapper = useTimeMapper();
    const userEvents = useProjectStore(s => s.userEvents);
    const sources = useProjectSources();
    const screenSourceId = useProjectStore(s => s.project.timeline.screenSourceId);

    const screenSource = sources[screenSourceId];

    return useMemo(() => {
        if (!userEvents || !screenSource) {
            return [];
        }

        return getAllFocusAreas(userEvents, timeMapper, screenSource.size);
    }, [userEvents, timeMapper, screenSource]);
}
