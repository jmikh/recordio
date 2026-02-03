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
import {
    BRIDGE_MSG,
    PORT_MSG,
    HANDOFF_PORT_NAME,
    type HandoffRequestResponse,
    type HandoffMetadataResponse,
    type ChunkPayload,
} from '@shared/types/bridge';
import type { RawRecording } from '@shared/types/recording';

const EXTENSION_ID = 'lpponocoanighhephabalkejmdbjlhmi';

// ============================================
// Types
// ============================================

export interface HandoffProgress {
    phase: 'metadata' | 'streaming' | 'complete';
    source: 'screen' | 'camera' | null;
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
    });

    // Refs for chunk accumulation - use Map with index as key to handle out-of-order arrival
    const screenChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const cameraChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const screenTotalRef = useRef<number>(0);
    const cameraTotalRef = useRef<number>(0);
    const metadataRef = useRef<HandoffMetadataResponse | null>(null);

    /**
     * Request handoff from extension.
     * Returns once all data is received and blobs are reconstructed.
     */
    const requestHandoff = useCallback(async (recordingId: string) => {
        console.log('[useExtensionBridge] Requesting handoff for:', recordingId);

        // Reset state
        screenChunksRef.current = new Map();
        cameraChunksRef.current = new Map();
        screenTotalRef.current = 0;
        cameraTotalRef.current = 0;
        metadataRef.current = null;

        setState({
            status: 'requesting',
            recordingId,
            error: null,
            progress: { phase: 'metadata', source: null, chunksReceived: 0, totalChunks: 0, bytesReceived: 0, totalBytes: 0 },
            recording: null,
            screenVideo: null,
            cameraVideo: null,
        });

        try {
            // Phase 1: Request metadata
            console.log('[useExtensionBridge] Phase 1: Requesting metadata');
            const response = await sendToExtension<HandoffRequestResponse>(EXTENSION_ID, {
                type: BRIDGE_MSG.HANDOFF_REQUEST,
                payload: { recordingId },
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to get recording metadata');
            }

            metadataRef.current = response;
            const totalBytes = response.screenVideoSize + (response.cameraVideoSize || 0);

            console.log('[useExtensionBridge] Metadata received:', {
                screenSize: response.screenVideoSize,
                cameraSize: response.cameraVideoSize,
            });

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
            console.log('[useExtensionBridge] Phase 2: Connecting port for streaming');
            await streamChunksViaPort(recordingId, totalBytes, setState);

            // Phase 3: Reconstruct blobs from ordered chunks
            console.log('[useExtensionBridge] Phase 3: Reconstructing blobs');

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

            // Debug: Calculate total bytes from chunks
            const screenChunkBytes = screenChunksOrdered.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const cameraChunkBytes = cameraVideo ?
                [...cameraChunksRef.current.values()].reduce((sum, chunk) => sum + chunk.byteLength, 0) : 0;

            console.log('[useExtensionBridge] Chunk validation:', {
                screenChunks: screenChunksRef.current.size,
                screenChunkBytes,
                expectedScreenBytes: response.screenVideoSize,
                screenMatch: screenChunkBytes === response.screenVideoSize,
                cameraChunks: cameraChunksRef.current.size,
                cameraChunkBytes,
                expectedCameraBytes: response.cameraVideoSize || 0,
                cameraMatch: response.cameraVideoSize ? cameraChunkBytes === response.cameraVideoSize : true,
            });

            if (screenChunkBytes !== response.screenVideoSize) {
                console.error('[useExtensionBridge] ⚠️ SCREEN SIZE MISMATCH!', {
                    expected: response.screenVideoSize,
                    actual: screenChunkBytes,
                    difference: response.screenVideoSize - screenChunkBytes,
                });
            }

            console.log('[useExtensionBridge] Blobs reconstructed:', {
                screenSize: screenVideo.size,
                cameraSize: cameraVideo?.size,
            });

            setState(prev => ({
                ...prev,
                status: 'success',
                progress: { ...prev.progress!, phase: 'complete' },
                recording: response.recording,
                screenVideo,
                cameraVideo,
            }));

        } catch (error) {
            console.error('[useExtensionBridge] Error:', error);
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

                            // Debug: Log every chunk
                            console.log(`[useExtensionBridge] Received chunk:`, {
                                source: chunk.source,
                                index: chunk.index,
                                total: chunk.total,
                                chunkBytes: data.byteLength,
                            });

                            // DEBUG: Delay last chunk by 10 seconds for UI inspection
                            // TODO: Remove this when done testing!
                            const isLastChunk = chunk.index === chunk.total - 1;
                            const processChunk = () => {
                                // Store chunk by index (handles out-of-order arrival)
                                if (chunk.source === 'screen') {
                                    screenChunksRef.current.set(chunk.index, data);
                                    screenTotalRef.current = chunk.total; // Update expected total
                                } else {
                                    cameraChunksRef.current.set(chunk.index, data);
                                    cameraTotalRef.current = chunk.total;
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

                                console.log(`[useExtensionBridge] Stored ${chunk.source} chunk ${chunk.index}/${chunk.total - 1} (${screenChunksRef.current.size + cameraChunksRef.current.size} total received)`);
                            };

                            if (isLastChunk) {
                                console.log('[useExtensionBridge] DEBUG: Last chunk detected, delaying 10 seconds...');
                                setTimeout(processChunk, 10000);
                            } else {
                                processChunk();
                            }
                            break;
                        }

                        case PORT_MSG.STREAM_COMPLETE:
                            console.log('[useExtensionBridge] Stream complete signal received, waiting 20s for UI inspection...');
                            // DEBUG: Wait 20 seconds before completing to allow UI inspection
                            // TODO: Remove this when done testing!
                            setTimeout(() => {
                                console.log('[useExtensionBridge] Stream complete (after delay)', {
                                    screenChunks: screenChunksRef.current.size,
                                    expectedScreen: screenTotalRef.current,
                                    cameraChunks: cameraChunksRef.current.size,
                                    expectedCamera: cameraTotalRef.current,
                                });
                                port.disconnect();
                                resolve();
                            }, 12000);
                            break;

                        case PORT_MSG.STREAM_ERROR:
                            console.error('[useExtensionBridge] Stream error:', message.payload);
                            port.disconnect();
                            reject(new Error(message.payload.error));
                            break;
                    }
                });

                port.onDisconnect.addListener(() => {
                    const chrome = (window as unknown as { chrome?: typeof globalThis.chrome }).chrome;
                    if (chrome?.runtime?.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || 'Port disconnected'));
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
            console.log('[useExtensionBridge] Handoff confirmed');
        } catch (error) {
            console.error('[useExtensionBridge] Error confirming handoff:', error);
        }
    }, [state.recordingId]);

    return { state, requestHandoff, confirmHandoff };
}
