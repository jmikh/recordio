/**
 * Fakes the extension side of the /import handoff.
 *
 * The import page reaches the extension only through chrome.runtime.sendMessage
 * (HANDOFF_REQUEST → metadata, HANDOFF_COMPLETE, IDENTIFY_USER) and
 * chrome.runtime.connect (START_STREAM → CHUNK… → STREAM_COMPLETE) — see
 * webapp/src/pages/import/useExtensionBridge.ts. A plain Playwright page has no
 * chrome.runtime at all, so installing a fake before any page script runs lets
 * the page's real logic (chunk reassembly, project create, upload, redirect)
 * execute against the local stack without loading the extension.
 *
 * Every sendMessage call is recorded on window.__extMockCalls for assertions.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { BRIDGE_MSG, PORT_MSG, HANDOFF_PORT_NAME } from '../../shared/types/bridge';
import type { RawRecording } from '../../shared/types';
import { EMPTY_USER_EVENTS, SCREEN_DURATION_MS, SCREEN_SIZE } from './project';

const SCREEN_WEBM = path.join(import.meta.dirname, 'assets/screen.webm');

// Far below the real 10MB CHUNK_SIZE so the ~60KB fixture still streams as
// several chunks and exercises the index-map reassembly in useExtensionBridge.
const MOCK_CHUNK_SIZE = 16 * 1024;

export interface ExtensionMockOptions {
    /** The recording the fake extension holds. Its id becomes the project id. */
    recordingId: string;
    name?: string;
    /** Reply to HANDOFF_REQUEST with this error instead of metadata. */
    failWith?: { error: string; code: 'NOT_FOUND' | 'STORAGE_ERROR' | 'UNKNOWN' };
}

/** Shape of entries in window.__extMockCalls. */
export interface RecordedBridgeCall {
    type: string;
    payload?: Record<string, unknown>;
}

export async function installExtensionMock(page: Page, options: ExtensionMockOptions): Promise<void> {
    const recording: RawRecording = {
        id: options.recordingId,
        name: options.name ?? 'e2e import recording',
        timestamp: Date.now(),
        screenSource: {
            // Extension-style placeholder — the import flow replaces it with the cloud path.
            storagePath: 'recordio-blob://screen',
            durationMs: SCREEN_DURATION_MS,
            hasAudio: false,
            size: SCREEN_SIZE,
        },
        userEvents: EMPTY_USER_EVENTS,
    };

    const screenB64 = readFileSync(SCREEN_WEBM).toString('base64');

    await page.addInitScript(
        ({ screenB64, recording, failWith, chunkSize, portName, BRIDGE_MSG, PORT_MSG }) => {
            const bin = atob(screenB64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

            const calls: { type: string; payload?: unknown }[] = [];
            (window as any).__extMockCalls = calls;

            const runtime = {
                lastError: undefined as undefined | { message: string },

                sendMessage: (_extensionId: string, message: any, callback?: (response: unknown) => void) => {
                    calls.push(message);
                    const respond = (response: unknown) => queueMicrotask(() => callback?.(response));

                    if (message?.type !== BRIDGE_MSG.HANDOFF_REQUEST) {
                        respond({ success: true });
                        return;
                    }
                    if (failWith) {
                        respond({ success: false, ...failWith });
                        return;
                    }
                    if (message.payload?.recordingId !== recording.id) {
                        respond({ success: false, error: 'Recording not found', code: 'NOT_FOUND' });
                        return;
                    }
                    respond({
                        success: true,
                        recording,
                        screenVideoSize: bytes.length,
                        screenVideoType: 'video/webm',
                        extensionDistinctId: 'e2e-mock-distinct-id',
                    });
                },

                connect: (_extensionId: string, connectInfo?: { name?: string }) => {
                    const listeners: ((message: unknown) => void)[] = [];
                    const emit = (message: unknown) => listeners.forEach(fn => fn(message));
                    return {
                        name: connectInfo?.name,
                        onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn) },
                        onDisconnect: { addListener: () => {} },
                        disconnect: () => {},
                        postMessage: (message: any) => {
                            if (connectInfo?.name !== portName || message?.type !== PORT_MSG.START_STREAM) return;
                            queueMicrotask(() => {
                                const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
                                for (let i = 0; i < total; i++) {
                                    const data = Array.from(bytes.subarray(i * chunkSize, (i + 1) * chunkSize));
                                    emit({ type: PORT_MSG.CHUNK, payload: { source: 'screen', index: i, total, data } });
                                }
                                emit({ type: PORT_MSG.STREAM_COMPLETE, payload: { recordingId: recording.id } });
                            });
                        },
                    };
                },
            };

            (window as any).chrome = { ...(window as any).chrome, runtime };
        },
        {
            screenB64,
            recording,
            failWith: options.failWith ?? null,
            chunkSize: MOCK_CHUNK_SIZE,
            portName: HANDOFF_PORT_NAME,
            BRIDGE_MSG,
            PORT_MSG,
        },
    );
}
