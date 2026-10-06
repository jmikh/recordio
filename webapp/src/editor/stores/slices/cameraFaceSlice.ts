import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { Project } from '@shared/types';
import type { Point } from '@shared/types/core';
import { setProjectOutsideHistory, type HistoryStore } from './outsideHistory';

export interface CameraFaceSlice {
    /**
     * Save the face anchor detected in the camera recording
     * (webapp/src/editor/faceDetection) as `camera.faceCenter`. It describes
     * the recording, not an edit: it bypasses undo and is stamped onto every
     * history snapshot too, so undo/redo can never drop it.
     */
    setCameraFaceCenter: (faceCenter: Point) => void;
}

export const createCameraFaceSlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], CameraFaceSlice> = (set, _get, store) => ({
    setCameraFaceCenter: (faceCenter) => {
        const withFaceCenter = (project: Project): Project => project.settings.camera
            ? { ...project, settings: { ...project.settings, camera: { ...project.settings.camera, faceCenter } } }
            : project;
        setProjectOutsideHistory(set, store.temporal as HistoryStore, withFaceCenter);
    },
});
