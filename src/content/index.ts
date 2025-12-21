import { logger } from '../utils/logger';

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

    let elementMeta = {};
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
    let elementMeta = {};
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
            sendMessageToBackground('CLICK', {
                ...bufferedMouseDown.event,
                timestamp: bufferedMouseDown.timestamp
            });
        } else {
            // Send split events: stored MOUSE DOWN then MOUSE UP
            sendMessageToBackground('MOUSEDOWN', {
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
    if (type != "MOUSE_POS") {
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

        sendMessageToBackground('MOUSE_POS', {
            timestamp: now,
            x: lastMouseX,
            y: lastMouseY,
        });
    }
}, MOUSE_POLL_INTERVAL);

// URL Capture
function sendUrlEvent() {
    sendMessageToBackground('URL_CHANGE', {
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
    // TODO: We might need to revisit this logic in the future
    const isInput = (target.isContentEditable && target.tagName === 'INPUT') || target.tagName === 'TEXTAREA';


    // Ignore standalone modifier keys (we only care about the combo)
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    // If in input, only capture Modifiers or Special keys (Enter/Tab/Esc)
    // If NOT in input, capture everything (for tool shortcuts like Figma 'v', 'r')

    const isModifier = e.ctrlKey || e.metaKey || e.altKey;
    const isSpecial = ['Enter', 'Tab', 'Escape', 'Backspace'].includes(e.key);

    const shouldCapture = !isInput || (isInput && (isModifier || isSpecial));

    console.log(`[Content] Keydown: ${e.key} | Target=${target.tagName} | isInput=${isInput} | isModifier=${isModifier} | isSpecial=${isSpecial} | Capture=${shouldCapture}`);

    if (shouldCapture) {
        sendMessageToBackground('KEYDOWN', {
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
});

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
