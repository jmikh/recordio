import type { Timeline, ID } from '../types';

/**
 * Functional logic for Timeline operations.
 */
export class TimelineImpl {
    /**
     * Creates a new Timeline with a default Recording.
     */
    static create(defaultScreenSourceId: ID = ''): Timeline {
        return {
            id: crypto.randomUUID(),
            durationMs: 0,
            outputWindows: [],
            recording: {
                timelineOffsetMs: 0,
                screenSourceId: defaultScreenSourceId,
                clickEvents: [],
                dragEvents: [],
                keyboardEvents: [],
                viewportMotions: []
            }
        };
    }
}
