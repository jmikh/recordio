import type { StoreApi } from 'zustand';
import type { TemporalState } from 'zundo';
import type { Project } from '@shared/types';

export type HistoryStore = StoreApi<TemporalState<{ project: Project }>>;

type ProjectSetter = (fn: (state: { project: Project }) => { project: Project }) => void;

/**
 * Applies a project change that describes the recording rather than an edit
 * (a computed camera matte, a detected face anchor): it bypasses undo and is
 * stamped onto every history snapshot too, so undo/redo can never drop it.
 */
export function setProjectOutsideHistory(set: ProjectSetter, history: HistoryStore, transform: (project: Project) => Project): void {
    // Only touch tracking when it's on — an in-flight slider drag holds
    // it paused (useHistoryBatcher) and must keep it that way
    const { isTracking, pause, resume } = history.getState();
    if (isTracking) pause();
    set(state => ({ project: transform(state.project) }));
    if (isTracking) resume();

    const patch = (states: Partial<{ project: Project }>[]) =>
        states.map(s => (s.project ? { ...s, project: transform(s.project) } : s));
    history.setState(h => ({ pastStates: patch(h.pastStates), futureStates: patch(h.futureStates) }));
}
