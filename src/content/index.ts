import { logger } from '../utils/logger';
import { type Size, EventType } from '../core/types';

// Prevent duplicate injection
if ((window as any).hasRecordoInjected) {
    throw new Error("Recordo content script already injected");
}
(window as any).hasRecordoInjected = true;

logger.log("[Recordo] Content script loaded");

let isRecording = false;

// Event Capture State
let lastMouseX = 0;
let lastMouseY = 0;
let lastMouseTime = 0;
let recordingStartTime = 0;
const MOUSE_POLL_INTERVAL = 100;

// Listen for recording state changes from background
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    logger.log("[Content] Received message:", message);
    if (message.type === 'RECORDING_STATUS_CHANGED') {
        isRecording = message.isRecording;
        if (isRecording && message.startTime) {
            recordingStartTime = message.startTime;
        }
        logger.log("[Content] isRecording updated to:", isRecording, "Start:", recordingStartTime);
    } else if (message.type === 'SHOW_COUNTDOWN') {
        startCountdown();
    }
});

function startCountdown() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
    overlay.style.zIndex = '2147483647'; // Max z-index
    overlay.style.color = 'white';
    overlay.style.fontSize = '120px';
    overlay.style.fontWeight = 'bold';
    overlay.style.fontFamily = 'sans-serif';
    overlay.style.pointerEvents = 'none'; // Click through? Maybe block clicks? Better block.
    // overlay.style.pointerEvents = 'auto'; 

    document.body.appendChild(overlay);

    let count = 3;
    overlay.innerText = count.toString();

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count.toString();
        } else {
            clearInterval(interval);
            overlay.remove();
            // Send finish timestamp
            chrome.runtime.sendMessage({ type: 'COUNTDOWN_FINISHED', timestamp: Date.now() });
        }
    }, 1000);
}

// Also check initial state safely
chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (response) => {
    // ... (existing code, assumes background might not have sent start time in GET_RECORDING_STATE yet? 
    // Actually GET_RECORDING_STATE response in background doesn't include timestamp. 
    // I should probably update background GET_RECORDING_STATE response too, but for now lets rely on the explicit start message or default)
    if (chrome.runtime.lastError) {
        logger.log("[Content] Setup error or orphaned:", chrome.runtime.lastError.message);
        return;
    }
    logger.log("[Content] Initial recording state:", response);
    if (response && response.isRecording) {
        isRecording = true;
        // If we missed the start message, we might lack recordingStartTime. 
        // Ideally background stores it.
    }
});


const captureOptions = { capture: true };



function sendMouseEvent(type: 'MOUSEDOWN' | 'MOUSEUP', e?: MouseEvent) {
    const x = e ? e.clientX : 0;
    const y = e ? e.clientY : 0;

    let elementMeta: Partial<Size> = {};
    if (e && e.target instanceof Element) {
        const rect = e.target.getBoundingClientRect();
        elementMeta = {
            width: rect.width,
            height: rect.height
        };
    }

    console.log(`[Content] Sending ${type} at (${x},${y})`);

    sendMessageToBackground(type, {
        timestamp: Date.now(),
        x,
        y,
        ...elementMeta,
    });
}

document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
}, captureOptions);

// Click Synthesis State
let bufferedMouseDown: { event: any, timestamp: number } | null = null;
const CLICK_THRESHOLD = 500; // ms

document.addEventListener('pointerdown', (e) => {
    // console.log("[Content] pointerdown");
    // Buffer the mousedown event
    const x = e.clientX;
    const y = e.clientY;
    let elementMeta: Partial<Size> = {};
    if (e.target instanceof Element) {
        const rect = e.target.getBoundingClientRect();
        elementMeta = {
            width: rect.width,
            height: rect.height
        };
    }

    bufferedMouseDown = {
        event: {
            x,
            y,
            ...elementMeta,
        },
        timestamp: Date.now()
    };
}, captureOptions);

document.addEventListener('pointerup', (e) => {
    // console.log("[Content] pointerup");

    if (bufferedMouseDown) {
        const now = Date.now();
        const diff = now - bufferedMouseDown.timestamp;

        if (diff <= CLICK_THRESHOLD) {
            // Synthesize CLICK
            // We use the timestamp of the MOUSE DOWN for consistency with where the action started?
            // User requested: "send the click event with timestamp of mouse down"
            sendMessageToBackground(EventType.CLICK, {
                ...bufferedMouseDown.event,
                timestamp: bufferedMouseDown.timestamp
            });
        } else {
            // Send split events: stored MOUSE DOWN then MOUSE UP
            sendMessageToBackground(EventType.MOUSEDOWN, {
                ...bufferedMouseDown.event,
                timestamp: bufferedMouseDown.timestamp
            });

            sendMouseEvent('MOUSEUP', e);
        }

        // Clear buffer
        bufferedMouseDown = null;
    } else {
        // Orphaned mouseup (maybe mousedown happened before inject?), just send it
        sendMouseEvent('MOUSEUP', e);
    }
}, captureOptions);

// Helper to safely send messages
function sendMessageToBackground(type: string, payload: any) {
    if (type != EventType.MOUSEPOS) {
        console.log("[Content] Sending message:", type, payload);
    }

    if (!chrome.runtime?.id) {
        // Extension context invalidated (e.g. extension reloaded). 
        // Stop doing work to avoid errors.
        logger.warn("[Recordo] Extension context invalidated. Please reload the page.");
        return;
    }

    // Apply DPR scaling to coordinates/dimensions
    const dpr = window.devicePixelRatio || 1;
    const scaledPayload = { ...payload };
    const keysToScale = ['x', 'y', 'width', 'height', 'lastX', 'lastY', 'startX', 'startY']; // Expanded list just in case

    for (const key of Object.keys(scaledPayload)) {
        if (keysToScale.includes(key) && typeof scaledPayload[key] === 'number') {
            scaledPayload[key] *= dpr;
        }
    }

    // Adjust timestamp to be relative to recording start
    if (recordingStartTime > 0 && typeof scaledPayload.timestamp === 'number') {
        const absoluteTs = scaledPayload.timestamp;
        scaledPayload.timestamp = Math.max(0, absoluteTs - recordingStartTime);
        scaledPayload.recordingStart = recordingStartTime;
        // Keep absolute too just in case
        scaledPayload.absoluteTimestamp = absoluteTs;
    }

    chrome.runtime.sendMessage({ type, payload: scaledPayload }).catch(() => {
        // Ignore connection errors
    });
}

// Poll for mouse position
setInterval(() => {
    if (!chrome.runtime?.id) return; // Stop polling if invalidated

    const now = Date.now();
    if (now - lastMouseTime >= MOUSE_POLL_INTERVAL) {
        lastMouseTime = now;

        sendMessageToBackground(EventType.MOUSEPOS, {
            timestamp: now,
            x: lastMouseX,
            y: lastMouseY,
        });
    }
}, MOUSE_POLL_INTERVAL);

// URL Capture
function sendUrlEvent() {
    sendMessageToBackground(EventType.URLCHANGE, {
        timestamp: Date.now(),
        url: window.location.href,
    });
}

window.addEventListener('popstate', sendUrlEvent);
window.addEventListener('hashchange', sendUrlEvent);
// Initial load
sendUrlEvent();

// History API Patch
const originalPushState = history.pushState;
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    sendUrlEvent();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    sendUrlEvent();
};

// Key Capture
window.addEventListener('keydown', (e) => {
    if (!chrome.runtime?.id) return;

    const target = e.target as HTMLElement;

    // Robust Input Detection
    const tagName = target.tagName;
    const isContentEditable = target.isContentEditable;
    // const isInputTag = tagName === 'INPUT' || tagName === 'TEXTAREA';

    // We treat standard inputs as 'Input' unless they are non-text types (like checkbox/radio)
    // Note: checking 'type' effectively for INPUT
    let isInput = isContentEditable || tagName === 'TEXTAREA';
    if (tagName === 'INPUT') {
        const type = (target as HTMLInputElement).type;
        // List of inputs that act more like buttons/toggles than text entry
        const nonTextInputs = ['checkbox', 'radio', 'button', 'image', 'submit', 'reset', 'range', 'color'];
        if (!nonTextInputs.includes(type)) {
            isInput = true;
        }
    }

    // Ignore standalone modifier keys (we only care about the combo)
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    // Filter Logic:
    // 1. If NOT in input: Capture Everything (shortcuts, navigation, etc)
    // 2. If IN input:
    //    - Capture 'Modifier' combos (Cmd+C, Ctrl+Z, etc)
    //    - Capture 'Special' keys (Enter, Esc, Tab)
    //    - IGNORE typing (Shift+c, a, etc)

    const isModifier = e.ctrlKey || e.metaKey || e.altKey;
    // We explicitly exclude arrow keys in inputs to reduce noise, unless user wants them.
    // User asked for "modifier key strokes... and definitely dont want... letter being input"
    // We include navigation keys if needed, but for now lets stick to "Special" functional keys.
    const isSpecial = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'].includes(e.key);

    const shouldCapture = !isInput || (isInput && (isModifier || isSpecial));

    // console.log(`[Content] Keydown: ${e.key} | Input=${isInput} | Mod=${isModifier} | Capture=${shouldCapture}`);

    if (shouldCapture) {
        // Exclude password inputs for privacy
        if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'password') {
            return;
        }

        sendMessageToBackground(EventType.KEYDOWN, {
            timestamp: Date.now(),
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            isInput,
            isModifier,
            isSpecial,
        });
    }
}, true); // Use Capture Phase to ensure we get events before site stops propagation

// Scroll Capture
let lastScrollTime = 0;
window.addEventListener('scroll', (e) => {
    // console.log("Scrolling"); 
    const now = Date.now();
    if (now - lastScrollTime < 500) {
        lastScrollTime = now;
        return; // 500ms throttle
    }
    lastScrollTime = now;

    if (!chrome.runtime?.id) return;

    let x = 0;
    let y = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let isNested = false;

    if (e.target instanceof Element) {
        // It's a nested element scroll
        const rect = e.target.getBoundingClientRect();
        x = rect.left;
        y = rect.top;
        width = rect.width;
        height = rect.height;
        isNested = true;
    }


    sendMessageToBackground('SCROLL', {
        timestamp: now,
        x,
        y,
        width,
        height,
        isNested,
    });
}, true); // Use capture to detect nested scrolls (which don't bubble)
