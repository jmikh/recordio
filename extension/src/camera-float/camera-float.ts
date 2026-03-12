/**
 * @fileoverview Camera Float Window Script
 *
 * Manages the camera float backing window and Document Picture-in-Picture lifecycle.
 * - Acquires camera stream from URL params
 * - "Pin on top" opens a Document PiP window (always-on-top)
 * - Backing window auto-minimizes after PiP opens
 * - PiP close returns video to backing window for re-pinning
 * - Listens for CLOSE_CAMERA_FLOAT to tear down
 */

import '../index.css';
import { MSG_TYPES } from '../shared/messageTypes';

// --- Inject page-specific styles ---
const style = document.createElement('style');
style.textContent = `
    .camera-float-body {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100vh;
        overflow: hidden;
        padding: 8px;
        gap: 6px;
    }

    .camera-float-video-container {
        position: relative;
        width: 100%;
        flex: 1;
        min-height: 0;
        border-radius: 8px;
        overflow: hidden;
        background: var(--surface-inset);
    }

    .camera-float-video-container video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
        border-radius: 8px;
    }

    .camera-float-note {
        text-align: center;
    }

    .camera-float-bottom {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 100%;
    }

    .camera-float-btn-pin {
        max-width: 200px;
    }

    .camera-float-bottom .subtext {
        text-align: center;
    }

    .camera-float-pip-icon {
        width: 16px;
        height: 16px;
    }

    .camera-float-status {
        font-size: 11px;
        color: var(--text-disabled);
    }
`;
document.head.appendChild(style);

// --- Parse URL params ---
const params = new URLSearchParams(window.location.search);
const deviceId = params.get('deviceId');
const mode = params.get('mode') || 'tab';

const videoEl = document.getElementById('cameraVideo') as HTMLVideoElement;
const btnPin = document.getElementById('btnPin') as HTMLButtonElement;
const videoContainer = document.getElementById('videoContainer') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const cameraNote = document.getElementById('cameraNote') as HTMLParagraphElement;

// Populate camera note
cameraNote.textContent = 'This is does not affect how your camera looks in the final recording. Camera is recorded separately and is fully adjustable in post. If you are recording an entire screen, move the float to a different screen or close it.';

let cameraStream: MediaStream | null = null;
let pipWindow: Window | null = null;

// --- Acquire camera ---
async function initCamera() {
    try {
        const constraints: MediaStreamConstraints = {
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
            audio: false,
        };
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl.srcObject = cameraStream;
    } catch (err) {
        console.error('[camera-float] Failed to acquire camera:', err);
        statusEl.textContent = 'Camera unavailable';
        btnPin.disabled = true;
    }
}

// --- Document PiP ---
async function openPiP() {
    if (!('documentPictureInPicture' in window)) {
        console.error('[camera-float] Document PiP API not available');
        statusEl.textContent = 'PiP not supported';
        return;
    }

    try {
        btnPin.disabled = true;
        statusEl.textContent = 'Opening…';

        // @ts-ignore — documentPictureInPicture is not yet in TS lib types
        pipWindow = await documentPictureInPicture.requestWindow({
            width: 320,
            height: 240,
        });

        if (!pipWindow) {
            console.error('[camera-float] PiP window returned null');
            btnPin.disabled = false;
            statusEl.textContent = '';
            return;
        }

        // Style the PiP document
        const pipDoc = pipWindow.document;
        pipDoc.body.style.cssText = `
            margin: 0;
            padding: 0;
            background: #111;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            overflow: hidden;
        `;

        // Create wrapper in PiP
        const wrapper = pipDoc.createElement('div');
        wrapper.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            overflow: hidden;
        `;

        // Move video element into PiP
        wrapper.appendChild(videoEl);
        videoEl.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            transform: scaleX(-1);
            border-radius: 0;
        `;



        pipDoc.body.appendChild(wrapper);

        // Auto-minimize backing window
        const currentWindowId = await getCurrentWindowId();
        if (currentWindowId !== null) {
            chrome.windows.update(currentWindowId, { state: 'minimized' }).catch(() => { });
        }

        statusEl.textContent = 'Pinned';

        // Listen for PiP close → re-show video in backing window
        pipWindow.addEventListener('pagehide', () => {
            handlePiPClose();
        });

    } catch (err) {
        console.error('[camera-float] Failed to open PiP:', err);
        btnPin.disabled = false;
        statusEl.textContent = 'PiP failed';
    }
}

function handlePiPClose() {
    pipWindow = null;

    // Move video back to backing window
    videoContainer.appendChild(videoEl);
    videoEl.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
        border-radius: 8px;
    `;

    // Re-enable Pin button
    btnPin.disabled = false;
    statusEl.textContent = '';

    // Restore (un-minimize) backing window
    getCurrentWindowId().then(windowId => {
        if (windowId !== null) {
            chrome.windows.update(windowId, { state: 'normal', focused: true }).catch(() => { });
        }
    });
}

async function getCurrentWindowId(): Promise<number | null> {
    try {
        const win = await chrome.windows.getCurrent();
        return win?.id ?? null;
    } catch {
        return null;
    }
}

// --- Cleanup ---
function cleanup() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    if (pipWindow) {
        try { pipWindow.close(); } catch { /* already closed */ }
        pipWindow = null;
    }
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MSG_TYPES.CLOSE_CAMERA_FLOAT) {
        cleanup();
        window.close();
    }
});

// --- Event bindings ---
btnPin.addEventListener('click', openPiP);

// Cleanup on window close
window.addEventListener('beforeunload', cleanup);

// --- Init ---
initCamera();
