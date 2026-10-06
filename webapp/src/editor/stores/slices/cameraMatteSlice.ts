import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { CameraMatteMetadata, Project } from '@shared/types';
import { setProjectOutsideHistory, type HistoryStore } from './outsideHistory';

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

export const createCameraMatteSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], CameraMatteSlice> = (set, _get, store) => ({
    cameraMatteJob: IDLE_CAMERA_MATTE_JOB,

    setCameraMatteJob: (updates) => set(state => ({
        cameraMatteJob: { ...state.cameraMatteJob, ...updates },
    })),

    setCameraMatte: (matte) => {
        const withMatte = (project: Project): Project => project.cameraSource
            ? { ...project, cameraSource: { ...project.cameraSource, matte } }
            : project;
        setProjectOutsideHistory(set, store.temporal as HistoryStore, withMatte);
    },
});
