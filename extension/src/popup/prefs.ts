/**
 * @fileoverview Popup preferences in chrome.storage.local (`recordio_prefs`).
 *
 * Read-merge-write so that views owning different fields (mic/camera in
 * PreRecordingView, the Video|Image mode in PopupApp) never clobber each
 * other's keys.
 */

export const PREFS_KEY = 'recordio_prefs';

export type PopupMode = 'video' | 'image';

export interface PopupPrefs {
    micEnabled?: boolean;
    camEnabled?: boolean;
    selectedMicId?: string;
    selectedCamId?: string;
    /** Which product the popup opens on (plans/screenshots) */
    mode?: PopupMode;
}

export async function loadPrefs(): Promise<PopupPrefs> {
    const result = await chrome.storage.local.get(PREFS_KEY);
    return (result[PREFS_KEY] as PopupPrefs | undefined) ?? {};
}

export async function updatePrefs(patch: Partial<PopupPrefs>): Promise<void> {
    const current = await loadPrefs();
    await chrome.storage.local.set({ [PREFS_KEY]: { ...current, ...patch } });
}
