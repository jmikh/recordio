import { logger } from '../utils/logger';
import { type Size, EventType, type MousePositionEvent, type Rect } from '../core/types';

// Prevent duplicate injection
if ((window as any).hasRecordoInjected) {
    throw new Error("Recordo content script already injected");
}
(window as any).hasRecordoInjected = true;

logger.log("[Recordo] Content script loaded");

let isRecording = false;

// Event Capture State
function getRelativeTime() {
    if (!isRecording || recordingStartTime === 0) return Date.now();
    return Math.max(0, Date.now() - recordingStartTime);
}

function getDeepActiveElement(): Element | null {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
    }
    return el;
}

// Event Capture State
let lastMousePos: MousePositionEvent = {
    type: EventType.MOUSEPOS,
    timestamp: 0,
    mousePos: { x: 0, y: 0 }
};
let lastMouseTime = 0;
let lastMouseMoveTime = 0;
let lastKeystrokeTime = 0;
let recordingStartTime = 0;

interface TypingSession {
    startTime: number;
    targetRect: Rect;
    element: HTMLElement;
}

let currentTypingSession: TypingSession | null = null;

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

function dprScalePoint(point: { x: number, y: number }): { x: number, y: number } {
    const dpr = window.devicePixelRatio || 1;
    return {
        x: point.x * dpr,
        y: point.y * dpr
    };
}

function dprScaleRect(rect: { x: number, y: number, width: number, height: number }) {
    const dpr = window.devicePixelRatio || 1;
    return {
        x: rect.x * dpr,
        y: rect.y * dpr,
        width: rect.width * dpr,
        height: rect.height * dpr
    };
}

document.addEventListener('mousemove', (e) => {
    if (!isRecording) return;
    lastMouseMoveTime = Date.now();
    const scaled = dprScalePoint({ x: e.clientX, y: e.clientY });
    lastMousePos = {
        type: EventType.MOUSEPOS,
        timestamp: getRelativeTime(),
        mousePos: scaled
    };
}, captureOptions);

// Click Synthesis State
let bufferedMouseDown: { event: any, timestamp: number } | null = null;
let dragPath: MousePositionEvent[] = [];
const CLICK_THRESHOLD = 500; // ms
const DRAG_DISTANCE_THRESHOLD = 5; // px

document.addEventListener('pointerdown', (e) => {
    if (!isRecording) return;
    const x = e.clientX;
    const y = e.clientY;
    const dpr = window.devicePixelRatio || 1;
    let elementMeta: Partial<Size> = {};
    if (e.target instanceof Element) {
        const rect = e.target.getBoundingClientRect();
        elementMeta = {
            width: rect.width * dpr,
            height: rect.height * dpr
        };
    }

    // Scale now!
    const scaledPos = dprScalePoint({ x, y });

    const now = getRelativeTime();
    bufferedMouseDown = {
        event: {
            mousePos: scaledPos,
            ...elementMeta, // Already scaled
        },
        timestamp: now
    };

    // Start tracking path (scaled)
    dragPath = [{
        type: EventType.MOUSEPOS,
        mousePos: scaledPos,
        timestamp: now
    }];

}, captureOptions);



document.addEventListener('pointerup', (e) => {
    if (!bufferedMouseDown) {
        return;
    }
    const now = getRelativeTime();
    const diff = now - bufferedMouseDown.timestamp;

    // Current posiiton (scaled)
    const scaledPos = dprScalePoint({ x: e.clientX, y: e.clientY });

    // Calculate distance moved
    const startPt = dragPath[0].mousePos;
    const dx = scaledPos.x - startPt.x;
    const dy = scaledPos.y - startPt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (diff <= CLICK_THRESHOLD && dist < DRAG_DISTANCE_THRESHOLD) {
        sendMessageToBackground(EventType.CLICK, {
            ...bufferedMouseDown.event, // Already scaled
            type: EventType.CLICK,
            timestamp: bufferedMouseDown.timestamp
        });
    } else {
        dragPath.push({
            type: EventType.MOUSEPOS,
            mousePos: scaledPos,
            timestamp: now
        });

        sendMessageToBackground(EventType.MOUSEDRAG, {
            type: EventType.MOUSEDRAG,
            timestamp: bufferedMouseDown.timestamp, // Start time
            mousePos: bufferedMouseDown.event.mousePos,
            path: dragPath, // Already scaled
            endTime: now
        });
    }

    // Clear buffer
    bufferedMouseDown = null;
    dragPath = [];
}, captureOptions);

// Helper to safely send messages
function sendMessageToBackground(type: string, payload: any) {
    if (!chrome.runtime?.id) {
        // Extension context invalidated (e.g. extension reloaded). 
        // Stop doing work to avoid errors.
        logger.warn("[Recordo] Extension context invalidated. Please reload the page.");
        return;
    }

    chrome.runtime.sendMessage({ type, payload }).catch(() => {
        // Ignore connection errors
    });
}

// Poll for mouse position
setInterval(() => {
    if (!chrome.runtime?.id) return; // Stop polling if invalidated
    if (!isRecording) return;

    const now = getRelativeTime();
    // Use Date.now() for interval check to avoid issues if recordingStartTime changes? 
    // Actually if we just use Date.now() for consistent interval check it's safer.
    const realNow = Date.now();
    if (realNow - lastMouseTime >= MOUSE_POLL_INTERVAL) {
        lastMouseTime = realNow;

        sendMessageToBackground(EventType.MOUSEPOS, {
            ...lastMousePos,
            timestamp: now
        });

        // If dragging, record point
        if (bufferedMouseDown) {
            dragPath.push({
                type: EventType.MOUSEPOS,
                mousePos: lastMousePos.mousePos,
                timestamp: now
            });
        }
    }

}, MOUSE_POLL_INTERVAL);

setInterval(() => {
    if (!chrome.runtime?.id) return;
    if (!isRecording) return;

    // Check for Typing Event
    const realNow = Date.now();
    const now = getRelativeTime();

    const activeEl = getDeepActiveElement() as HTMLElement;
    const isEditable = activeEl && isEditableElement(activeEl);

    let isTypingActive = false;

    if (isEditable) {
        const isTyping = (realNow - lastKeystrokeTime) < 1000;
        const isStationary = (realNow - lastMouseMoveTime) > 500;

        if (isTyping) {
            isTypingActive = true;
        } else if (isStationary) {
            // Checks if mouse is stationary and it is close to the input box then the user is probably typing but maybe pausing between typing.
            const rect = activeEl.getBoundingClientRect();

            const dpr = window.devicePixelRatio || 1;
            const scaledRect = dprScaleRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
            const mouseX = lastMousePos.mousePos.x;
            const mouseY = lastMousePos.mousePos.y;

            const threshold = 100 * dpr;

            // Simple distance to box check
            // If inside, distance is 0.
            const closestX = Math.max(scaledRect.x, Math.min(mouseX, scaledRect.x + scaledRect.width));
            const closestY = Math.max(scaledRect.y, Math.min(mouseY, scaledRect.y + scaledRect.height));

            const dx = mouseX - closestX;
            const dy = mouseY - closestY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= threshold) {
                isTypingActive = true;
            }
        }

        // Session Logic
        if (currentTypingSession) {
            // If session is active, check if we should end it
            // End if:
            // 1. Not typing active anymore
            // 2. Active element changed (or lost focus)

            let shouldEnd = false;
            if (!isTypingActive) {
                shouldEnd = true;
            } else if (activeEl !== currentTypingSession.element) {
                shouldEnd = true;
            }

            if (shouldEnd) {
                // Dispatch Event
                const eventStartTime = currentTypingSession.startTime;
                // Use current 'now' as endTime
                sendMessageToBackground(EventType.TYPING, {
                    type: EventType.TYPING,
                    timestamp: eventStartTime,
                    mousePos: lastMousePos.mousePos,
                    targetRect: currentTypingSession.targetRect,
                    endTime: now
                });
                currentTypingSession = null;
            } else {
                // Still active
            }
        } else {
            // No session active. Should we start one?
            if (isTypingActive && isEditable) {
                const rect = activeEl.getBoundingClientRect();
                const scaledRect = dprScaleRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });

                let startTime = now;
                if ((realNow - lastKeystrokeTime) < 1000) {
                    if (recordingStartTime > 0) {
                        startTime = Math.max(0, lastKeystrokeTime - recordingStartTime);
                    }
                }

                currentTypingSession = {
                    startTime: startTime,
                    targetRect: scaledRect,
                    element: activeEl
                };
            }
        }
    }
}, 400);

// URL Capture
function sendUrlEvent() {
    if (!isRecording) return;
    sendMessageToBackground(EventType.URLCHANGE, {
        timestamp: getRelativeTime(),
        mousePos: lastMousePos.mousePos, // Use last known pos
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
    if (!isRecording) return;

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

    if (isInput) {
        lastKeystrokeTime = Date.now();
    }

    const shouldCapture = !isInput || (isInput && (isModifier || isSpecial));

    // console.log(`[Content] Keydown: ${e.key} | Input=${isInput} | Mod=${isModifier} | Capture=${shouldCapture}`);

    if (shouldCapture) {
        // Exclude password inputs for privacy
        if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'password') {
            return;
        }

        sendMessageToBackground(EventType.KEYDOWN, {
            timestamp: getRelativeTime(),
            mousePos: lastMousePos.mousePos, // Attach last known position
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

/**
 * Detects the effective scrollable area by probing the center of the screen.
 * It finds the main content column by walking up from the center element.
 * We look for the "outermost" container that is still smaller than the viewport.
 */
function getLayoutAwareViewport(): Rect {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    let el = document.elementFromPoint(cx, cy);

    // Default to full window
    let bestRect: Rect = {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight
    };
    let chosenDiv: Element | null = null;
    console.log("layoutAwareViewport center element:", el);

    while (el && el !== document.body && el !== document.documentElement) {
        const rect = el.getBoundingClientRect();

        // Check if wider than 20% but narrower than full viewport
        // (Use -1 tolerance for full width detection)
        if (rect.width > window.innerWidth * 0.8) {
            // Found a full-width container (or close to it). 
            // Since parents can't be narrower than children usually, 
            // any previous 'bestRect' was the outermost narrow one.
            break;
        }

        if (rect.width > window.innerWidth * 0.2) {
            // It is a valid candidate (narrower than viewport, but significant size)
            // We update bestRect and keep going up to find a potentially wider/outer parent
            // that is still within the narrow constraint.
            bestRect = {
                x: rect.left,
                y: 0, // Assume full height for the scroll track
                width: rect.width,
                height: window.innerHeight
            };
            chosenDiv = el;
        }

        el = el.parentElement;
    }

    console.log("bestRect:", bestRect, chosenDiv);
    return bestRect;
}

// Scroll Capture
let lastScrollTime = 0;
window.addEventListener('scroll', (e) => {
    if (!isRecording) return;
    // console.log("Scrolling"); 
    const now = getRelativeTime();
    const realNow = Date.now();

    if (realNow - lastScrollTime < 100) {
        lastScrollTime = realNow;
        return;
    }
    lastScrollTime = realNow;

    if (!chrome.runtime?.id) return;

    let boundingBox: Rect;

    if (e.target instanceof Element) {
        // It's a nested element scroll
        const rect = e.target.getBoundingClientRect();
        boundingBox = {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
        };
    } else {
        // Full Page Scroll - detect effective viewport
        boundingBox = getLayoutAwareViewport();
    }


    sendMessageToBackground('SCROLL', {
        timestamp: now,
        mousePos: lastMousePos.mousePos,
        boundingBox: dprScaleRect(boundingBox)
    });
}, true); // Use capture to detect nested scrolls (which don't bubble)

// Focus/Blur Capture
function isEditableElement(target: HTMLElement): boolean {
    const tagName = target.tagName;
    const isContentEditable = target.isContentEditable;

    let isInput = isContentEditable || tagName === 'TEXTAREA';
    if (tagName === 'INPUT') {
        const type = (target as HTMLInputElement).type;
        const nonTextInputs = ['checkbox', 'radio', 'button', 'image', 'submit', 'reset', 'range', 'color'];
        if (!nonTextInputs.includes(type)) {
            isInput = true;
        }
    }
    return isInput;
}

// TODO: remove before shipping.
window.addEventListener('focusin', (e) => {
    const path = e.composedPath();
    const deepTarget = (path[0] || e.target) as HTMLElement;
    const rect = deepTarget.getBoundingClientRect();
    const isEditable = isEditableElement(deepTarget);

    if (isEditable) {
        logger.log(`[Recordo] TEXT INPUT Focus In:`, {
            target: deepTarget,
            rect,
        });
    } else {
        logger.log(`[Recordo] NON-TEXT INPUT Focus In:`, {
            target: deepTarget,
            rect,
        });
    }
});