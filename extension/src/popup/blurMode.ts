/**
 * @fileoverview Blur picker entry point shared by the popup views.
 */

import { MSG_TYPES } from '../shared/messageTypes';

/**
 * Enter blur picker mode on the active tab, then close the popup so the user can
 * interact with the page. Tabs without a content script (chrome://, web store, etc.)
 * reject the message — nothing to blur there, so the popup simply stays open.
 * Background/content close the picker again when recording starts or resumes.
 */
export async function enterBlurMode(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
        await chrome.tabs.sendMessage(tab.id, { type: MSG_TYPES.POPUP_ENABLE_BLUR_MODE });
        window.close();
    } catch {
        // No content script on this tab
    }
}

/**
 * Close the blur picker on every tab. Called when the popup opens: the popup is the
 * control surface, so a picking session left behind on a page should end there.
 */
export async function closeBlurMode(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: MSG_TYPES.POPUP_DISABLE_BLUR_MODE }).catch(() => { });
    }
}
