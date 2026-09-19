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
    HANDOFF_TIMEOUT_MS,
    KEEPALIVE_INTERVAL_MS,
    type HandoffRequestResponse,
    type HandoffMetadataResponse,
    type HandoffKind,
    type ChunkPayload,
} from '@shared/types/bridge';
import type { RawRecording, RawScreenshot } from '@shared/types';

/** Extension ID — read from the `ext` query param (set by the extension when opening
 *  the import page), with a fallback to the Web Store production ID. */
const EXTENSION_ID = new URLSearchParams(window.location.search).get('ext')
    || 'bbcdpipjplklaneplfmlhhibnllhinii';

// ============================================
// Types
// ============================================

export interface HandoffProgress {
    phase: 'metadata' | 'streaming' | 'complete';
    source: ChunkPayload['source'] | null;
    chunksReceived: number;
    totalChunks: number;
    bytesReceived: number;
    totalBytes: number;
}

/**
 * Why a handoff failed. Reported to both Sentry (tag) and Mixpanel (property) so
 * the silent-stall class of failure is distinguishable in the funnel.
 *
 * - `metadata`        — extension never answered HANDOFF_REQUEST
 * - `stall`           — connected, but no chunk arrived for HANDOFF_TIMEOUT_MS.
 *                       Usually the MV3 service worker was terminated mid-stream.
 * - `port-disconnected` — port closed before STREAM_COMPLETE
 * - `stream-error`    — extension explicitly reported STREAM_ERROR
 */
export type HandoffFailureKind = 'metadata' | 'stall' | 'port-disconnected' | 'stream-error';

/** Error carrying the failure kind out of the streaming promise. */
class HandoffError extends Error {
    readonly kind: HandoffFailureKind;
    constructor(message: string, kind: HandoffFailureKind) {
        super(message);
        this.name = 'HandoffError';
        this.kind = kind;
    }
}

export interface HandoffState {
    status: 'idle' | 'requesting' | 'streaming' | 'success' | 'error';
    /** The capture id (recording or screenshot) being handed off */
    recordingId: string | null;
    /** Known once metadata arrives */
    kind: HandoffKind | null;
    error: string | null;
    /** Set alongside `status: 'error'` — what kind of failure this was */
    failureKind: HandoffFailureKind | null;
    progress: HandoffProgress | null;
    // Result data (available when status === 'success')
    recording: RawRecording | null;
    screenVideo: Blob | null;
    cameraVideo: Blob | null;
    micAudio: Blob | null;
    /** Screenshot handoff (plans/screenshots): capture metadata + the PNG */
    screenshot: RawScreenshot | null;
    image: Blob | null;
    extensionDistinctId: string | null;
}

/** Total payload bytes announced by the metadata response. */
function totalBytesOf(meta: HandoffMetadataResponse): number {
    if (meta.kind === 'screenshot') return meta.imageSize;
    return meta.screenVideoSize + (meta.cameraVideoSize || 0) + (meta.micAudioSize || 0);
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
        kind: null,
        failureKind: null,
        error: null,
        progress: null,
        recording: null,
        screenVideo: null,
        cameraVideo: null,
        micAudio: null,
        screenshot: null,
        image: null,
        extensionDistinctId: null,
    });

    // Refs for chunk accumulation - use Map with index as key to handle out-of-order arrival
    const screenChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const cameraChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const micChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const imageChunksRef = useRef<Map<number, Uint8Array>>(new Map());
    const screenTotalRef = useRef<number>(0);
    const cameraTotalRef = useRef<number>(0);
    const micTotalRef = useRef<number>(0);
    const imageTotalRef = useRef<number>(0);
    const metadataRef = useRef<HandoffMetadataResponse | null>(null);

    /** Re-entrancy guard. Two concurrent handoffs for the same capture open two
     *  ports, make the extension encode and send everything twice, and write into
     *  the same chunk Maps — which `requestHandoff` resets on entry, so the first
     *  stream can reassemble a half-cleared Map. Doubling the service worker's
     *  memory is also a good way to get it killed mid-transfer. */
    const inFlightRef = useRef(false);

    const chunksReceived = () =>
        screenChunksRef.current.size + cameraChunksRef.current.size + micChunksRef.current.size + imageChunksRef.current.size;
    const chunksExpected = () =>
        screenTotalRef.current + cameraTotalRef.current + micTotalRef.current + imageTotalRef.current;

    /**
     * Request handoff from extension.
     * Returns once all data is received and blobs are reconstructed.
     */
    const requestHandoff = useCallback(async (recordingId: string) => {
        if (inFlightRef.current) {
            console.warn(`[handoff] ignoring duplicate requestHandoff for ${recordingId} — one is already in flight`);
            return;
        }
        inFlightRef.current = true;

        // Reset state
        screenChunksRef.current = new Map();
        cameraChunksRef.current = new Map();
        micChunksRef.current = new Map();
        imageChunksRef.current = new Map();
        screenTotalRef.current = 0;
        cameraTotalRef.current = 0;
        micTotalRef.current = 0;
        imageTotalRef.current = 0;
        metadataRef.current = null;

        setState({
            status: 'requesting',
            recordingId,
            kind: null,
            failureKind: null,
            error: null,
            progress: { phase: 'metadata', source: null, chunksReceived: 0, totalChunks: 0, bytesReceived: 0, totalBytes: 0 },
            recording: null,
            screenVideo: null,
            cameraVideo: null,
            micAudio: null,
            screenshot: null,
            image: null,
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
            const kind: HandoffKind = response.kind === 'screenshot' ? 'screenshot' : 'recording';
            const totalBytes = totalBytesOf(response);

            setState(prev => ({
                ...prev,
                status: 'streaming',
                kind,
                progress: {
                    phase: 'streaming',
                    source: kind === 'screenshot' ? 'image' : 'screen',
                    chunksReceived: 0,
                    totalChunks: 0,
                    bytesReceived: 0,
                    totalBytes,
                },
            }));

            // Phase 2: Stream chunks via Port

            await streamChunksViaPort(recordingId, totalBytes, setState);

            // Phase 3: Reconstruct blobs from ordered chunks

            if (response.kind === 'screenshot') {
                const imageChunksOrdered = reassembleChunks(imageChunksRef.current, imageTotalRef.current);
                const image = new Blob(imageChunksOrdered as BlobPart[], { type: response.imageType });
                if (image.size !== response.imageSize) {
                    captureImportError(
                        new Error(`Image blob size mismatch: expected ${response.imageSize}, got ${image.size}`),
                        { recordingId, phase: 'streaming', extra: { kind: 'screenshot' } },
                    );
                }
                setState(prev => ({
                    ...prev,
                    status: 'success',
                    progress: { ...prev.progress!, phase: 'complete' },
                    screenshot: response.screenshot,
                    image,
                    extensionDistinctId: response.extensionDistinctId || null,
                }));
                return;
            }

            // Reassemble chunks in correct order
            const screenChunksOrdered = reassembleChunks(screenChunksRef.current, screenTotalRef.current);
            const screenVideo = new Blob(screenChunksOrdered as BlobPart[], {
                type: response.screenVideoType,
            });

            let cameraVideo: Blob | null = null;
            if (cameraChunksRef.current.size > 0 && cameraTotalRef.current > 0) {
                const cameraChunksOrdered = reassembleChunks(cameraChunksRef.current, cameraTotalRef.current);
                cameraVideo = new Blob(cameraChunksOrdered as BlobPart[], {
                    type: response.cameraVideoType!,
                });
            }

            let micAudio: Blob | null = null;
            if (micChunksRef.current.size > 0 && micTotalRef.current > 0) {
                const micChunksOrdered = reassembleChunks(micChunksRef.current, micTotalRef.current);
                micAudio = new Blob(micChunksOrdered as BlobPart[], {
                    type: response.micAudioType!,
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
            const meta = metadataRef.current;
            const recordingMeta = meta && meta.kind !== 'screenshot' ? meta : null;
            const primaryChunks = meta?.kind === 'screenshot' ? imageChunksRef.current : screenChunksRef.current;

            // Streaming failures are already reported to Sentry by `fail()`, with
            // richer timing context — don't double-report them here.
            if (!(error instanceof HandoffError)) {
                captureImportError(error, {
                    recordingId,
                    phase: meta ? 'streaming' : 'receiving',
                    bridgeStatus: meta ? 'post-metadata' : 'pre-metadata',
                    screenVideoSize: recordingMeta?.screenVideoSize,
                    cameraVideoSize: recordingMeta?.cameraVideoSize,
                    micAudioSize: recordingMeta?.micAudioSize,
                    extra: meta?.kind === 'screenshot' ? { kind: 'screenshot', imageSize: meta.imageSize } : undefined,
                    progress: {
                        bytesReceived: [...primaryChunks.values()].reduce((s, c) => s + c.byteLength, 0),
                        totalBytes: meta ? totalBytesOf(meta) : 0,
                        chunksReceived: chunksReceived(),
                        totalChunks: chunksExpected(),
                        source: null,
                    },
                });
            }

            setState(prev => ({
                ...prev,
                status: 'error',
                failureKind: error instanceof HandoffError ? error.kind : 'metadata',
                error: error instanceof Error ? error.message : 'Failed to communicate with extension',
            }));
        } finally {
            inFlightRef.current = false;
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

            /** Guards against double-settling: onDisconnect always fires after
             *  STREAM_COMPLETE/STREAM_ERROR, and the stall timer can race both. */
            let settled = false;
            let stallTimer: ReturnType<typeof setTimeout> | null = null;
            let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

            const startedAt = performance.now();
            let lastChunkAt = startedAt;
            /** Per-source timing, logged on completion so we can see where time goes. */
            const sourceTiming = new Map<string, { chunks: number; bytes: number; decodeMs: number }>();

            // Declared outside the try so the catch below can always clear them.
            const clearStall = () => {
                if (stallTimer !== null) {
                    clearTimeout(stallTimer);
                    stallTimer = null;
                }
                if (keepAliveTimer !== null) {
                    clearInterval(keepAliveTimer);
                    keepAliveTimer = null;
                }
            };

            try {
                const port = connectToExtension(EXTENSION_ID, HANDOFF_PORT_NAME);

                const progressSnapshot = () => ({
                    bytesReceived,
                    totalBytes,
                    chunksReceived: chunksReceived(),
                    totalChunks: chunksExpected(),
                    source: null,
                });

                const succeed = () => {
                    if (settled) return;
                    settled = true;
                    clearStall();
                    const elapsedMs = performance.now() - startedAt;
                    console.log(
                        `[handoff] complete: ${(bytesReceived / 1e6).toFixed(1)}MB in ${(elapsedMs / 1000).toFixed(2)}s ` +
                        `(${(bytesReceived / 1e6 / (elapsedMs / 1000)).toFixed(1)} MB/s)`,
                        Object.fromEntries(sourceTiming),
                    );
                    port.disconnect();
                    resolve();
                };

                /** Single exit for every failure: logs, reports to Sentry, rejects
                 *  with the kind so ImportPage can report it to Mixpanel too. */
                const fail = (message: string, kind: HandoffFailureKind) => {
                    if (settled) return;
                    settled = true;
                    clearStall();
                    const err = new HandoffError(message, kind);
                    console.error(`[handoff] failed (${kind}):`, message, progressSnapshot());
                    captureImportError(err, {
                        recordingId,
                        phase: 'streaming',
                        bridgeStatus: kind,
                        progress: progressSnapshot(),
                        extra: {
                            elapsedMs: Math.round(performance.now() - startedAt),
                            msSinceLastChunk: Math.round(performance.now() - lastChunkAt),
                            sourceTiming: Object.fromEntries(sourceTiming),
                        },
                    });
                    try { port.disconnect(); } catch { /* already gone */ }
                    reject(err);
                };

                /** (Re)arm the stall watchdog. The MV3 service worker can be
                 *  terminated mid-stream, which closes the port with no
                 *  `lastError` — without this the promise would never settle. */
                const armStall = () => {
                    clearStall();
                    stallTimer = setTimeout(() => {
                        fail(
                            `Transfer stalled: no data from the extension for ${Math.round(HANDOFF_TIMEOUT_MS / 1000)}s ` +
                            `at ${bytesReceived} of ${totalBytes} bytes`,
                            'stall',
                        );
                    }, HANDOFF_TIMEOUT_MS);
                };

                port.onMessage.addListener((message) => {
                    switch (message.type) {
                        case PORT_MSG.CHUNK: {
                            const chunk = message.payload as ChunkPayload;
                            const decodeStart = performance.now();
                            const data = new Uint8Array(chunk.data);
                            const decodeMs = performance.now() - decodeStart;

                            lastChunkAt = performance.now();
                            armStall();

                            const timing = sourceTiming.get(chunk.source)
                                ?? { chunks: 0, bytes: 0, decodeMs: 0 };
                            timing.chunks += 1;
                            timing.bytes += data.byteLength;
                            timing.decodeMs += decodeMs;
                            sourceTiming.set(chunk.source, timing);

                            if (import.meta.env.DEV) {
                                console.log(
                                    `[handoff] chunk ${chunk.index + 1}/${chunk.total} (${chunk.source}) ` +
                                    `${(data.byteLength / 1e6).toFixed(1)}MB decoded in ${decodeMs.toFixed(0)}ms`,
                                );
                            }

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
                            } else if (chunk.source === 'image') {
                                imageChunksRef.current.set(chunk.index, data);
                                imageTotalRef.current = chunk.total;
                            }

                            bytesReceived += data.byteLength;

                            setStateCallback(prev => ({
                                ...prev,
                                progress: {
                                    phase: 'streaming',
                                    source: chunk.source,
                                    chunksReceived: chunksReceived(),
                                    totalChunks: chunksExpected(),
                                    bytesReceived,
                                    totalBytes,
                                },
                            }));


                            break;
                        }

                        case PORT_MSG.STREAM_COMPLETE:
                            succeed();
                            break;

                        case PORT_MSG.STREAM_ERROR:
                            fail(message.payload?.error || 'Stream error from extension', 'stream-error');
                            break;
                    }
                });

                // A disconnect before STREAM_COMPLETE is always a failure. When the
                // MV3 service worker is terminated the port closes *cleanly* — no
                // `lastError` — so this must not be gated on it, or the handoff
                // hangs silently at whatever percentage it reached.
                port.onDisconnect.addListener(() => {
                    const chrome = (window as unknown as { chrome?: typeof globalThis.chrome }).chrome;
                    const lastError = chrome?.runtime?.lastError?.message;
                    fail(
                        lastError
                            || 'The extension disconnected before the transfer finished '
                            + '(its background service worker was most likely terminated).',
                        'port-disconnected',
                    );
                });

                // Keep the extension's MV3 service worker from being terminated
                // mid-transfer. It only posts chunks outward while streaming, which
                // does not count as activity, so a transfer longer than the ~30s
                // idle timeout gets the worker killed. An inbound port message
                // resets that timer — including on extensions old enough not to
                // know this message type, since the reset happens on delivery.
                keepAliveTimer = setInterval(() => {
                    if (settled) return;
                    try {
                        port.postMessage({ type: PORT_MSG.KEEPALIVE });
                    } catch {
                        // Port already torn down; onDisconnect handles the failure.
                    }
                }, KEEPALIVE_INTERVAL_MS);

                // Start streaming
                armStall();
                port.postMessage({
                    type: PORT_MSG.START_STREAM,
                    payload: { recordingId },
                });

            } catch (error) {
                clearStall();
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            }
        });
    }, []);

    /**
     * Confirm handoff complete (extension can delete its copy).
     * `projectId` is the created cloud row's id — for screenshots, the
     * screenshot id (the bridge payload field predates screenshots).
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

    return { state, requestHandoff, confirmHandoff };
}
