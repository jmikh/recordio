import { navigate } from '../navigate';

/**
 * Mac Native Bridge — handles recording handoff from the RecordioMac WKWebView.
 *
 * The Mac app sends recording metadata via evaluateJavaScript(), and serves the
 * video file via a custom URL scheme (recordio-native://video/{sessionId}).
 *
 * Flow:
 * 1. Swift calls window.recordioMacBridge.onRecordingReady(metadata, videoUrl)
 * 2. This bridge fetches the video from recordio-native://video/{id}
 * 3. Calls importFromRawRecording(metadata, videoBlob)
 * 4. Navigates to the editor
 */

import { importFromRawRecording } from '../storage/projectStorage';

/** Detect if running inside the RecordioMac WKWebView */
export function isRecordioMacApp(): boolean {
    return typeof (window as any).webkit?.messageHandlers?.recordioNative !== 'undefined';
}

/** Send a message to the Swift native bridge */
export function sendToNative(type: string, payload?: Record<string, any>) {
    if ((window as any).webkit?.messageHandlers?.recordioNative) {
        (window as any).webkit.messageHandlers.recordioNative.postMessage({
            type,
            payload: payload ?? {},
        });
    }
}

interface RecordioMacBridge {
    onRecordingReady: (metadata: any, videoUrl: string) => void;
}

declare global {
    interface Window {
        recordioMacBridge?: RecordioMacBridge;
        __recordioPendingRecording?: { metadata: any; videoUrl: string };
    }
}

/**
 * Initialize the Mac bridge listener.
 * Call once on app startup (e.g., in main.tsx or App.tsx).
 */
export function initMacBridge(): void {
    if (!isRecordioMacApp()) {
        return; // Not inside WKWebView — skip
    }

    console.log('[MacBridge] Initializing Mac native bridge...');

    // Set up the bridge listener
    window.recordioMacBridge = {
        onRecordingReady: async (metadata: any, videoUrl: string) => {
            console.log('[MacBridge] Recording ready:', metadata.id);
            console.log('[MacBridge] Video URL:', videoUrl);

            try {
                // Fetch the video from the custom URL scheme
                console.log('[MacBridge] Fetching video...');
                const response = await fetch(videoUrl);

                if (!response.ok) {
                    throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
                }

                const videoBlob = await response.blob();
                console.log(`[MacBridge] Video fetched: ${(videoBlob.size / 1024 / 1024).toFixed(1)} MB`);

                // Import the recording using the existing import infrastructure
                console.log('[MacBridge] Importing recording...');
                const project = await importFromRawRecording(
                    metadata,
                    videoBlob
                );

                console.log(`[MacBridge] Project created: ${project.id}`);

                // Notify the Mac app that handoff is complete
                sendToNative('HANDOFF_COMPLETE', { projectId: project.id });

                // Navigate to the editor
                navigate(`/editor?projectId=${project.id}`);

            } catch (error) {
                console.error('[MacBridge] Handoff failed:', error);
                sendToNative('HANDOFF_ERROR', { error: String(error) });
            }
        }
    };

    // Check for any pending recording that arrived before we initialized
    if (window.__recordioPendingRecording) {
        console.log('[MacBridge] Found pending recording, processing...');
        const { metadata, videoUrl } = window.__recordioPendingRecording;
        delete window.__recordioPendingRecording;
        window.recordioMacBridge.onRecordingReady(metadata, videoUrl);
    }

    console.log('[MacBridge] Bridge ready');
}

/**
 * Download a blob via the native Mac app save dialog.
 * Converts the blob to base64 and sends it to Swift for NSSavePanel display.
 *
 * Returns true if the blob was sent to native, false if not in Mac app context.
 */
export async function downloadViaNative(blob: Blob, filename: string): Promise<boolean> {
    if (!isRecordioMacApp()) {
        return false;
    }

    try {
        // Convert blob to base64 for transfer via postMessage
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        sendToNative('DOWNLOAD_FILE', {
            filename,
            mimeType: blob.type,
            base64Data: base64,
            size: blob.size,
        });

        console.log(`[MacBridge] Sent download request: ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
        return true;
    } catch (error) {
        console.error('[MacBridge] Download via native failed:', error);
        return false;
    }
}

