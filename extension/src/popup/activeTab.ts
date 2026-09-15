/**
 * @fileoverview "Can we capture the active tab?" — a URL check shared by the
 * recording and screenshot views (cheaper than a scripting round-trip).
 * chrome://, the Web Store, other extensions' pages and PDF viewers reject
 * both tabCapture and captureVisibleTab.
 */

export async function isActiveTabCapturable(): Promise<boolean> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? '';
    const injectable =
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('file://');
    return !!tab?.id && injectable;
}
