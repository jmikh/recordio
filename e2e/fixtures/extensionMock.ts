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
import type { RawRecording, RawScreenshot } from '../../shared/types';
import { EMPTY_USER_EVENTS, SCREEN_DURATION_MS, SCREEN_SIZE } from './project';
import { SCREENSHOT_PNG, SCREENSHOT_SIZE } from './screenshot';

const SCREEN_WEBM = path.join(import.meta.dirname, 'assets/screen.webm');

// Far below the real 10MB CHUNK_SIZE so the ~60KB fixture still streams as
// several chunks and exercises the index-map reassembly in useExtensionBridge.
const MOCK_CHUNK_SIZE = 16 * 1024;

export interface ExtensionMockOptions {
    /** The recording (or screenshot) the fake extension holds. Its id becomes the project/screenshot id. */
    recordingId: string;
    name?: string;
    /** Reply to HANDOFF_REQUEST with this error instead of metadata. */
    failWith?: { error: string; code: 'NOT_FOUND' | 'STORAGE_ERROR' | 'UNKNOWN' };
    /**
     * Hand off a screenshot (plans/screenshots) instead of a recording: the
     * metadata reply carries `kind: 'screenshot'` and the port streams the
     * fixture PNG as `'image'` chunks.
     */
    kind?: 'recording' | 'screenshot';
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

    const isScreenshot = options.kind === 'screenshot';
    const screenshot: RawScreenshot = {
        kind: 'screenshot',
        id: options.recordingId,
        name: options.name ?? 'e2e import screenshot',
        timestamp: Date.now(),
        captureMode: 'visible',
        image: { storagePath: `recordio-blob://shot-${options.recordingId}-image`, mimeType: 'image/png', size: SCREENSHOT_SIZE },
        page: {
            url: 'https://example.com/e2e',
            title: options.name ?? 'e2e import screenshot',
            viewport: SCREENSHOT_SIZE,
            devicePixelRatio: 1,
            scale: 1,
        },
    };

    const screenB64 = readFileSync(isScreenshot ? SCREENSHOT_PNG : SCREEN_WEBM).toString('base64');

    await page.addInitScript(
        ({ screenB64, recording, screenshot, isScreenshot, failWith, chunkSize, portName, BRIDGE_MSG, PORT_MSG }) => {
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
                    if (isScreenshot) {
                        respond({
                            success: true,
                            kind: 'screenshot',
                            screenshot,
                            imageSize: bytes.length,
                            imageType: 'image/png',
                            extensionDistinctId: 'e2e-mock-distinct-id',
                        });
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
                                    emit({ type: PORT_MSG.CHUNK, payload: { source: isScreenshot ? 'image' : 'screen', index: i, total, data } });
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
            screenshot,
            isScreenshot,
            failWith: options.failWith ?? null,
            chunkSize: MOCK_CHUNK_SIZE,
            portName: HANDOFF_PORT_NAME,
            BRIDGE_MSG,
            PORT_MSG,
        },
    );
}
