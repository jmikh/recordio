import { useState, useRef, useCallback } from 'react';
import { ExportManager, type ExportProgress, type ExportEnvironment } from '@shared/export/ExportManager';
import { browserRenderContext } from '../../../core/renderContext';
import { useMediaUrlStore } from '../../stores/useMediaUrlStore';
import { getClickSoundBuffer, getDragSoundBuffers } from '../../../core/audio/clickSoundPlayer';
import { LocalPreferences } from '../../../storage/localPreferences';
import { useProjectStore } from '../../stores/useProjectStore';
import type { Project } from '@shared/types';

interface UseLocalRenderOptions {
    project: Project;
    projectName: string;
    videoDecodePreference: 'gpu' | 'cpu';
    onDecodeFallback: () => void;
}

export function useLocalRender({ project, projectName, videoDecodePreference, onDecodeFallback }: UseLocalRenderOptions) {
    const [isLocalRendering, setIsLocalRendering] = useState(false);
    const [localRenderProgress, setLocalRenderProgress] = useState<ExportProgress | null>(null);
    const exportRef = useRef<ExportManager | null>(null);

    const startOrCancel = useCallback(async (): Promise<
        { success: true; message: string } | { success: false; error: string | null }
    > => {
        if (isLocalRendering) {
            exportRef.current?.cancel();
            return { success: false, error: null };
        }

        setIsLocalRendering(true);
        setLocalRenderProgress(null);
        const exportManager = new ExportManager();
        exportRef.current = exportManager;

        try {
            const [clickBuffer, dragBuffers] = await Promise.all([
                getClickSoundBuffer(),
                getDragSoundBuffers(),
            ]);

            // Sync persisted decode pref so FrameExtractor picks up the toggle
            LocalPreferences.setPreferSoftwareDecode(videoDecodePreference === 'cpu');

            const env: ExportEnvironment = {
                renderContext: browserRenderContext,
                videoDecodePreference,
                onDecodeFallback,
                decodePreferences: {
                    getPreferSoftwareDecode: () => LocalPreferences.getPreferSoftwareDecode(),
                    setPreferSoftwareDecode: (v) => LocalPreferences.setPreferSoftwareDecode(v),
                },
                soundEffects: {
                    click: clickBuffer,
                    dragDown: dragBuffers.down,
                    dragUp: dragBuffers.up,
                },
                mediaUrls: useMediaUrlStore.getState().urls,
            };

            // Runtime store strips userEvents from project — reconstruct full project
            const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };

            const result = await exportManager.exportProject(
                fullProject,
                '1080p',
                (progress) => setLocalRenderProgress(progress),
                { skipDownload: false },
                env,
                projectName,
            );

            // Download the blob
            const url = URL.createObjectURL(result.blob!);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName || 'render'}_local.mp4`;
            a.click();
            URL.revokeObjectURL(url);

            return {
                success: true,
                message: `Decode: ${result.videoDecodeMode}, Codec: ${result.codecs.video.encoder}`,
            };
        } catch (e: any) {
            if (e?.message === 'Export cancelled') {
                return { success: false, error: null };
            }
            return { success: false, error: e?.message || 'Unknown error' };
        } finally {
            setIsLocalRendering(false);
            setLocalRenderProgress(null);
            exportRef.current = null;
        }
    }, [isLocalRendering, project, projectName, videoDecodePreference, onDecodeFallback]);

    return { isLocalRendering, localRenderProgress, startOrCancel };
}
