import type { StateCreator, StoreApi } from 'zustand';
import type { TemporalState } from 'zundo';
import type { ProjectState } from '../useProjectStore';
import type { CameraMatteMetadata, Project } from '@shared/types';

/** `preparing` covers the model load — a one-time download on first use. */
export type CameraMatteJobStatus = 'idle' | 'preparing' | 'processing' | 'uploading' | 'error';

export interface CameraMatteJob {
    status: CameraMatteJobStatus;
    /** 0–1 within the current status */
    progress: number;
    error: string | null;
}

export interface CameraMatteSlice {
    /** The background-removal job for the loaded project (webapp/src/editor/cameraMatte) */
    cameraMatteJob: CameraMatteJob;
    setCameraMatteJob: (updates: Partial<CameraMatteJob>) => void;
    /**
     * Attach a computed matte to the camera source. It describes the
     * recording, not an edit: it bypasses undo and is stamped onto every
     * history snapshot too, so undo/redo can never drop it.
     */
    setCameraMatte: (matte: CameraMatteMetadata) => void;
}

export const IDLE_CAMERA_MATTE_JOB: CameraMatteJob = { status: 'idle', progress: 0, error: null };

type HistoryStore = StoreApi<TemporalState<{ project: Project }>>;

export const createCameraMatteSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], CameraMatteSlice> = (set, _get, store) => ({
    cameraMatteJob: IDLE_CAMERA_MATTE_JOB,

    setCameraMatteJob: (updates) => set(state => ({
        cameraMatteJob: { ...state.cameraMatteJob, ...updates },
    })),

    setCameraMatte: (matte) => {
        const withMatte = (project: Project): Project => project.cameraSource
            ? { ...project, cameraSource: { ...project.cameraSource, matte } }
            : project;

        const history = store.temporal as HistoryStore;
        // Only touch tracking when it's on — an in-flight slider drag holds
        // it paused (useHistoryBatcher) and must keep it that way
        const { isTracking, pause, resume } = history.getState();
        if (isTracking) pause();
        set(state => ({ project: withMatte(state.project) }));
        if (isTracking) resume();

        const patch = (states: Partial<{ project: Project }>[]) =>
            states.map(s => (s.project ? { ...s, project: withMatte(s.project) } : s));
        history.setState(h => ({ pastStates: patch(h.pastStates), futureStates: patch(h.futureStates) }));
    },
});
