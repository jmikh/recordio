console.log("Recordo content script loaded");

let isRecording = false;

// Listen for recording state changes from background
chrome.runtime.onMessage.addListener((message) => {
    console.log("[Content] Received message:", message);
    if (message.type === 'RECORDING_STATUS_CHANGED') {
        isRecording = message.isRecording;
        console.log("[Content] isRecording updated to:", isRecording);
    }
});

// Also check initial state safely
chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (response) => {
    if (chrome.runtime.lastError) {
        // Background might not be ready or we are orphaned
        console.log("[Content] Setup error or orphaned:", chrome.runtime.lastError.message);
        return;
    }
    console.log("[Content] Initial recording state:", response);
    if (response?.isRecording) {
        isRecording = true;
    }
});

document.addEventListener('click', (event) => {
    if (!isRecording) {
        console.log("[Content] Click ignored (not recording)");
        return;
    }

    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();

    console.log("[Content] Capture CLICK on:", target.tagName);

    const metadata = {
        timestamp: Date.now(),
        tagName: target.tagName,
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
    };

    chrome.runtime.sendMessage({
        type: 'CLICK_EVENT',
        payload: metadata
    });
}, true); // Capture phase to ensure we catch it
