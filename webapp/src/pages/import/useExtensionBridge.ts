/**
 * useExtensionBridge Hook
 * 
 * Handles direct communication with the Chrome extension for recording handoff.
 * 
 * Protocol:
 * 1. Request metadata via sendMessage (HANDOFF_REQUEST)
 * 2. Stream video chunks via Port connection
 * 3. Confirm handoff via sendMessage (HANDOFF_COMPLETE)
 */

import { useCallback, useState, useRef } from 'react';
import { captureImportError, captureError } from '../../lib/sentry';
import {
    BRIDGE_MSG,
    PORT_MSG,
    HANDOFF_PORT_NAME,
    type HandoffRequestResponse,
    type HandoffMetadataResponse,
    type ChunkPayload,
} from '@shared/types/bridge';
import type { RawRecording } from '@shared/types';

/** Extension ID — read from the `ext` query param (set by the extension when opening
 *  the import page), with a fallback to the Web Store production ID. */
const EXTENSION_ID = new URLSearchParams(window.location.search).get('ext')
    || 'bbcdpipjplklaneplfmlhhibnllhinii';

// ============================================
// Types
// ============================================

export interface HandoffProgress {
    phase: 'metadata' | 'streaming' | 'complete';
    source: 'screen' | 'camera' | 'mic' | null;
    chunksReceived: number;
    totalChunks: number;
    bytesReceived: number;
    totalBytes: number;
}

export interface HandoffState {
    status: 'idle' | 'requesting' | 'streaming' | 'success' | 'error';
    recordingId: string | null;
    error: string | null;
    progress: HandoffProgress | null;
    // Result data (available when status === 'success')
    recording: RawRecording | null;
    screenVideo: Blob | null;
    cameraVideo: Blob | null;
    micAudio: Blob | null;
    extensionDistinctId: string | null;
}

// ============================================
// Chrome Runtime Helpers
// ============================================

/**
 * Send a message to the Chrome extension using externally_connectable.
 * Uses callback API (not Promise) as required for external messaging.
 */
function sendToExtension<T>(
    extensionId: string,
    message: unknown
): Promise<T> {
    return new Promise((resolve, reject) => {
        const chrome = (window as unknown as { chrome?: typeof globalThis.chrome }).chrome;

        if (!chrome?.runtime?.sendMessage) {
            reject(new Error(
                'Chrome runtime not available. ' +
                'Make sure: (1) You are in Chrome, (2) Extension is installed and enabled, ' +
                '(3) Extension manifest has externally_connectable with this origin.'
            ));
            return;
        }

        try {
            chrome.runtime.sendMessage(extensionId, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || 'Extension communication failed'));
                    return;
                }

                if (response === undefined) {
                    reject(new Error('No response from extension'));
                    return;
                }

                resolve(response as T);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Open a Port connection to the extension for streaming.
 */
function connectToExtension(extensionId: string, name: string): chrome.runtime.Port {
    const chrome = (window as unknown as { chrome?: typeof globalThis.chrome }).chrome;

    if (!chrome?.runtime?.connect) {
        throw new Error('Chrome runtime.connect not available');
    }

    return chrome.runtime.connect(extensionId, { name });
}

/**
 * Reassemble chunks from a Map into an ordered array.
 * Chunks are stored by index to handle out-of-order arrival.
 */
function reassembleChunks(chunkMap: Map<number, Uint8Array>, expectedTotal: number): Uint8Array[] {
    const ordered: Uint8Array[] = [];
    for (let i = 0; i < expectedTotal; i++) {
        const chunk = chunkMap.get(i);
        if (!chunk) {
            console.error(`[useExtensionBridge] Missing chunk at index ${i}!`);
            throw new Error(`Missing chunk at index ${i}`);
        }
        ordered.push(chunk);
    }
    return ordered;
}

// ============================================
// Hook
// ============================================

export function useExtensionBridge() {
    const [state, setState] = useState<HandoffState>({
        status: 'idle',
        recordingId: null,
        error: null,
        progress: null,
        recording: null,
        screenVideo: null,
        cameraVideo: null,
        micAudio: null,
        extensionDistinctId: null,
    });

    // Refs for chunk accumulation - use Map with index as key to handle out-of-order arrival
    const screenChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const cameraChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const micChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const screenTotalRef = useRef<number>(0);
    const cameraTotalRef = useRef<number>(0);
    const micTotalRef = useRef<number>(0);
    const metadataRef = useRef<HandoffMetadataResponse | null>(null);

    /**
     * Request handoff from extension.
     * Returns once all data is received and blobs are reconstructed.
     */
    const requestHandoff = useCallback(async (recordingId: string) => {


        // Reset state
        screenChunksRef.current = new Map();
        cameraChunksRef.current = new Map();
        micChunksRef.current = new Map();
        screenTotalRef.current = 0;
        cameraTotalRef.current = 0;
        micTotalRef.current = 0;
        metadataRef.current = null;

        setState({
            status: 'requesting',
            recordingId,
            error: null,
            progress: { phase: 'metadata', source: null, chunksReceived: 0, totalChunks: 0, bytesReceived: 0, totalBytes: 0 },
            recording: null,
            screenVideo: null,
            cameraVideo: null,
            micAudio: null,
            extensionDistinctId: null,
        });

        try {
            // Phase 1: Request metadata

            const response = await sendToExtension<HandoffRequestResponse>(EXTENSION_ID, {
                type: BRIDGE_MSG.HANDOFF_REQUEST,
                payload: { recordingId },
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to get recording metadata');
            }

            metadataRef.current = response;
            const totalBytes = response.screenVideoSize + (response.cameraVideoSize || 0) + (response.micAudioSize || 0);



            setState(prev => ({
                ...prev,
                status: 'streaming',
                progress: {
                    phase: 'streaming',
                    source: 'screen',
                    chunksReceived: 0,
                    totalChunks: 0,
                    bytesReceived: 0,
                    totalBytes,
                },
            }));

            // Phase 2: Stream chunks via Port

            await streamChunksViaPort(recordingId, totalBytes, setState);

            // Phase 3: Reconstruct blobs from ordered chunks


            // Reassemble chunks in correct order
            const screenChunksOrdered = reassembleChunks(screenChunksRef.current, screenTotalRef.current);
            const screenVideo = new Blob(screenChunksOrdered as BlobPart[], {
                type: metadataRef.current!.screenVideoType,
            });

            let cameraVideo: Blob | null = null;
            if (cameraChunksRef.current.size > 0 && cameraTotalRef.current > 0) {
                const cameraChunksOrdered = reassembleChunks(cameraChunksRef.current, cameraTotalRef.current);
                cameraVideo = new Blob(cameraChunksOrdered as BlobPart[], {
                    type: metadataRef.current!.cameraVideoType!,
                });
            }

            let micAudio: Blob | null = null;
            if (micChunksRef.current.size > 0 && micTotalRef.current > 0) {
                const micChunksOrdered = reassembleChunks(micChunksRef.current, micTotalRef.current);
                micAudio = new Blob(micChunksOrdered as BlobPart[], {
                    type: metadataRef.current!.micAudioType!,
                });
            }

            // Debug: Calculate total bytes from chunks
            const screenChunkBytes = screenChunksOrdered.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const cameraChunkBytes = cameraVideo ?
                [...cameraChunksRef.current.values()].reduce((sum, chunk) => sum + chunk.byteLength, 0) : 0;



            if (screenChunkBytes !== response.screenVideoSize) {
                const mismatchInfo = {
                    expected: response.screenVideoSize,
                    actual: screenChunkBytes,
                    difference: response.screenVideoSize - screenChunkBytes,
                };
                console.error('[useExtensionBridge] ⚠️ SCREEN SIZE MISMATCH!', mismatchInfo);
                captureImportError(
                    new Error(`Screen blob size mismatch: expected ${response.screenVideoSize}, got ${screenChunkBytes}`),
                    {
                        recordingId,
                        phase: 'streaming',
                        screenVideoSize: response.screenVideoSize,
                        cameraVideoSize: response.cameraVideoSize,
                        extra: mismatchInfo,
                    }
                );
            }



            setState(prev => ({
                ...prev,
                status: 'success',
                progress: { ...prev.progress!, phase: 'complete' },
                recording: response.recording,
                screenVideo,
                cameraVideo,
                micAudio,
                extensionDistinctId: response.extensionDistinctId || null,
            }));

        } catch (error) {
            console.error('[useExtensionBridge] Error:', error);
            captureImportError(error, {
                recordingId,
                phase: metadataRef.current ? 'streaming' : 'receiving',
                bridgeStatus: metadataRef.current ? 'post-metadata' : 'pre-metadata',
                screenVideoSize: metadataRef.current?.screenVideoSize,
                cameraVideoSize: metadataRef.current?.cameraVideoSize,
                micAudioSize: metadataRef.current?.micAudioSize,
                progress: {
                    bytesReceived: screenChunksRef.current.size > 0
                        ? [...screenChunksRef.current.values()].reduce((s, c) => s + c.byteLength, 0)
                        : 0,
                    totalBytes: metadataRef.current
                        ? (metadataRef.current.screenVideoSize + (metadataRef.current.cameraVideoSize || 0) + (metadataRef.current.micAudioSize || 0))
                        : 0,
                    chunksReceived: screenChunksRef.current.size + cameraChunksRef.current.size + micChunksRef.current.size,
                    totalChunks: screenTotalRef.current + cameraTotalRef.current + micTotalRef.current,
                    source: null,
                },
            });
            setState(prev => ({
                ...prev,
                status: 'error',
                error: error instanceof Error ? error.message : 'Failed to communicate with extension',
            }));
        }
    }, []);

    /**
     * Stream chunks via Port connection.
     */
    const streamChunksViaPort = useCallback((
        recordingId: string,
        totalBytes: number,
        setStateCallback: typeof setState
    ): Promise<void> => {
        return new Promise((resolve, reject) => {
            let bytesReceived = 0;

            try {
                const port = connectToExtension(EXTENSION_ID, HANDOFF_PORT_NAME);

                port.onMessage.addListener((message) => {
                    switch (message.type) {
                        case PORT_MSG.CHUNK: {
                            const chunk = message.payload as ChunkPayload;
                            const data = new Uint8Array(chunk.data);

                            // Store chunk by index (handles out-of-order arrival)
                            if (chunk.source === 'screen') {
                                screenChunksRef.current.set(chunk.index, data);
                                screenTotalRef.current = chunk.total; // Update expected total
                            } else if (chunk.source === 'camera') {
                                cameraChunksRef.current.set(chunk.index, data);
                                cameraTotalRef.current = chunk.total;
                            } else if (chunk.source === 'mic') {
                                micChunksRef.current.set(chunk.index, data);
                                micTotalRef.current = chunk.total;
                            }

                            bytesReceived += data.byteLength;

                            // Calculate total chunks received across both sources
                            const totalChunksReceived = screenChunksRef.current.size + cameraChunksRef.current.size;

                            setStateCallback(prev => ({
                                ...prev,
                                progress: {
                                    phase: 'streaming',
                                    source: chunk.source,
                                    chunksReceived: totalChunksReceived,
                                    totalChunks: screenTotalRef.current + cameraTotalRef.current,
                                    bytesReceived,
                                    totalBytes,
                                },
                            }));


                            break;
                        }

                        case PORT_MSG.STREAM_COMPLETE:
                            port.disconnect();
                            resolve();
                            break;

                        case PORT_MSG.STREAM_ERROR:
                            console.error('[useExtensionBridge] Stream error:', message.payload);
                            captureImportError(
                                new Error(message.payload.error || 'Stream error from extension'),
                                {
                                    recordingId,
                                    phase: 'streaming',
                                    progress: {
                                        bytesReceived,
                                        totalBytes,
                                        chunksReceived: screenChunksRef.current.size + cameraChunksRef.current.size + micChunksRef.current.size,
                                        totalChunks: screenTotalRef.current + cameraTotalRef.current + micTotalRef.current,
                                        source: null,
                                    },
                                }
                            );
                            port.disconnect();
                            reject(new Error(message.payload.error));
                            break;
                    }
                });

                port.onDisconnect.addListener(() => {
                    const chrome = (window as unknown as { chrome?: typeof globalThis.chrome }).chrome;
                    if (chrome?.runtime?.lastError) {
                        const err = new Error(chrome.runtime.lastError.message || 'Port disconnected');
                        captureImportError(err, {
                            recordingId,
                            phase: 'streaming',
                            bridgeStatus: 'port-disconnected',
                            progress: {
                                bytesReceived,
                                totalBytes,
                                chunksReceived: screenChunksRef.current.size + cameraChunksRef.current.size + micChunksRef.current.size,
                                totalChunks: screenTotalRef.current + cameraTotalRef.current + micTotalRef.current,
                                source: null,
                            },
                        });
                        reject(err);
                    }
                });

                // Start streaming
                port.postMessage({
                    type: PORT_MSG.START_STREAM,
                    payload: { recordingId },
                });

            } catch (error) {
                reject(error);
            }
        });
    }, []);

    /**
     * Confirm handoff complete (extension can delete its copy).
     */
    const confirmHandoff = useCallback(async (projectId: string) => {
        if (!state.recordingId) return;

        try {
            await sendToExtension(EXTENSION_ID, {
                type: BRIDGE_MSG.HANDOFF_COMPLETE,
                payload: {
                    recordingId: state.recordingId,
                    projectId,
                },
            });

        } catch (error) {
            captureError(error, { flow: 'import', phase: 'confirm_handoff', extra: { recordingId: state.recordingId } });
        }
    }, [state.recordingId]);

    /**
     * Send the logged-in user's email to the extension for Mixpanel identity.
     * Fire-and-forget — analytics should never block the import flow.
     */
    const sendIdentify = useCallback((email: string) => {
        sendToExtension(EXTENSION_ID, {
            type: BRIDGE_MSG.IDENTIFY_USER,
            payload: { email },
        }).catch(e => console.error('[useExtensionBridge] Error sending identify:', e));
    }, []);

    return { state, requestHandoff, confirmHandoff, sendIdentify };
}
