/**
 * Webapp wrapper around shared ExportManager.
 *
 * Injects browser-specific dependencies: renderContext, download function,
 * Sentry error reporting, useUIStore decode preference, sound effect buffers.
 */

import * as Sentry from '@sentry/react';
import { ExportManager as SharedExportManager, type ExportProgress, type ExportResult, type ExportEnvironment } from '@shared/export/ExportManager';
import { browserRenderContext } from '../../core/renderContext';
import { downloadViaNative } from '../../bridge/macBridge';
import { useUIStore } from '../stores/useUIStore';
import { getClickSoundBuffer, getDragSoundBuffers } from '../../core/audio/clickSoundPlayer';
import { LocalPreferences } from '../../storage/localPreferences';
import type { DecodePreferences } from '@shared/export/FrameExtractor';

export type { ExportQuality } from '@shared/export/codecResolver';
export type { ExportProgress, ExportCodecInfo, ExportResult } from '@shared/export/ExportManager';

const localDecodePreferences: DecodePreferences = {
    getPreferSoftwareDecode: () => LocalPreferences.getPreferSoftwareDecode(),
    setPreferSoftwareDecode: (v) => LocalPreferences.setPreferSoftwareDecode(v),
};

export class ExportManager {
    private inner = new SharedExportManager();

    async exportProject(
        project: import('@shared/types').Project,
        quality: import('@shared/utils/exportQuality').ExportQuality,
        onProgress: (state: ExportProgress) => void,
        options?: { skipDownload?: boolean }
    ): Promise<ExportResult> {
        // Load sound effect buffers for click/drag mixing
        const [clickBuffer, dragBuffers] = await Promise.all([
            getClickSoundBuffer(),
            getDragSoundBuffers(),
        ]);

        const env: ExportEnvironment = {
            renderContext: browserRenderContext,
            videoDecodePreference: useUIStore.getState().videoDecodePreference as 'gpu' | 'cpu',
            onDecodeFallback: () => {
                useUIStore.getState().setVideoDecodePreference('cpu');
            },
            decodePreferences: localDecodePreferences,
            soundEffects: {
                click: clickBuffer,
                dragDown: dragBuffers.down,
                dragUp: dragBuffers.up,
            },
        };

        const wrappedOnProgress = (state: ExportProgress) => {
            onProgress(state);
        };

        try {
            const result = await this.inner.exportProject(project, quality, wrappedOnProgress, options, env);

            if (!options?.skipDownload) {
                await this.downloadBlob(result.blob, `${project.name}_${quality}.mp4`);
            }

            return result;
        } catch (e) {
            Sentry.captureException(e instanceof Error ? e : new Error(String(e)));
            throw e;
        }
    }

    cancel() {
        this.inner.cancel();
    }

    private async downloadBlob(blob: Blob, filename: string) {
        // In Mac app: use native save dialog via Swift bridge
        const sentToNative = await downloadViaNative(blob, filename);
        if (sentToNative) return;

        // Browser fallback: standard anchor download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
