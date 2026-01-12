import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import { TranscriptionService } from '../../../core/TranscriptionService';

export interface TranscriptionSlice {
    isTranscribing: boolean;
    transcriptionProgress: number;
    transcriptionError: string | null;

    generateTranscription: () => Promise<void>;
    deleteTranscription: () => void;
}

export const createTranscriptionSlice: StateCreator<
    ProjectState,
    [['zustand/subscribeWithSelector', never], ['temporal', unknown]],
    [],
    TranscriptionSlice
> = (set, get, store) => ({
    isTranscribing: false,
    transcriptionProgress: 0,
    transcriptionError: null,

    generateTranscription: async () => {
        const state = get();
        const cameraSourceId = state.project.timeline.recording.cameraSourceId;

        if (!cameraSourceId) {
            console.error('[TranscriptionSlice] No camera source available for transcription');
            set({ transcriptionError: 'No webcam recording found' });
            return;
        }

        const cameraSource = Object.values(state.sources).find((s: any) => s.id === cameraSourceId);
        if (!cameraSource) {
            console.error('[TranscriptionSlice] Camera source not found:', cameraSourceId);
            set({ transcriptionError: 'Webcam source not found' });
            return;
        }

        try {
            set({
                isTranscribing: true,
                transcriptionProgress: 0,
                transcriptionError: null
            });

            // Fetch the webcam video blob
            const response = await fetch(cameraSource.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch webcam video: ${response.statusText}`);
            }

            const videoBlob = await response.blob();

            // Run transcription
            const transcriptionService = TranscriptionService.getInstance();
            const transcriptionData = await transcriptionService.transcribeWebcamAudio(
                videoBlob,
                (progress) => {
                    set({ transcriptionProgress: progress });
                }
            );

            // Store transcription in project - pause history to avoid polluting undo
            const temporal = (store as any).temporal;
            temporal?.getState().pause();

            set(state => ({
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        recording: {
                            ...state.project.timeline.recording,
                            captions: transcriptionData
                        }
                    },
                    updatedAt: new Date()
                }
            }));

            temporal?.getState().resume();

            set({
                isTranscribing: false,
                transcriptionProgress: 1
            });

            console.log('[TranscriptionSlice] Transcription complete:', transcriptionData.segments.length, 'segments');
        } catch (error) {
            console.error('[TranscriptionSlice] Transcription failed:', error);
            set({
                isTranscribing: false,
                transcriptionError: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        }
    },

    deleteTranscription: () => {
        console.log('[Action] deleteTranscription');
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    recording: {
                        ...state.project.timeline.recording,
                        captions: undefined
                    }
                },
                updatedAt: new Date()
            },
            transcriptionError: null
        }));
    }
});
