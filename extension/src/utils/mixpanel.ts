/**
 * @fileoverview Lightweight Mixpanel tracker for Chrome Extension Service Worker
 * 
 * Uses Mixpanel's HTTP Track API via fetch (mixpanel-browser requires DOM).
 * Fire-and-forget — errors are logged but never block recording flow.
 */

import { EDITOR_ORIGIN_PROD } from '@shared/urls';

const MIXPANEL_TOKEN = '773bc18d036f7f77ec70ec94e7eec508';
const MIXPANEL_API_URL = `${EDITOR_ORIGIN_PROD}/mp/track`;
const DISTINCT_ID_KEY = 'mixpanel_distinct_id';

const IS_PRODUCTION = import.meta.env.MODE === 'production';

// ============================================================================
// Distinct ID (anonymous, persisted in chrome.storage.local)
// ============================================================================

let cachedDistinctId: string | null = null;

export async function getDistinctId(): Promise<string> {
    if (cachedDistinctId) return cachedDistinctId;

    try {
        const result = await chrome.storage.local.get(DISTINCT_ID_KEY);
        const storedId = result[DISTINCT_ID_KEY] as string | undefined;
        if (storedId) {
            cachedDistinctId = storedId;
            return cachedDistinctId;
        }
    } catch (e) {
        console.error('[Mixpanel] Failed to read distinct_id:', e);
    }

    // Generate and persist a new one
    cachedDistinctId = crypto.randomUUID();
    try {
        await chrome.storage.local.set({ [DISTINCT_ID_KEY]: cachedDistinctId });
    } catch (e) {
        console.error('[Mixpanel] Failed to persist distinct_id:', e);
    }
    return cachedDistinctId;
}

// ============================================================================
// Core Track (fire-and-forget)
// ============================================================================

async function track(eventName: string, properties: Record<string, any> = {}) {
    if (!IS_PRODUCTION) {
        console.log(`[Mixpanel] ${eventName}`, properties);
        return;
    }

    try {
        const distinctId = await getDistinctId();
        const payload = [{
            event: eventName,
            properties: {
                token: MIXPANEL_TOKEN,
                distinct_id: distinctId,
                time: Math.floor(Date.now() / 1000),
                $insert_id: crypto.randomUUID(),
                source: 'extension',
                extension_version: chrome.runtime.getManifest?.()?.version || 'unknown',
                ...properties,
            },
        }];

        fetch(MIXPANEL_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
            body: JSON.stringify(payload),
        }).catch(e => console.error('[Mixpanel] fetch failed:', e));
    } catch (e) {
        console.error('[Mixpanel] track error:', e);
    }
}

// ============================================================================
// Public API
// ============================================================================

export function trackRecordingStarted(props: {
    recording_current_window: boolean;
    hasAudio: boolean;
    hasCamera: boolean;
}) {
    track('recording_started', props);
}

export function trackRecordingFinished(props: {
    recording_current_window: boolean;
    duration_ms: number;
    hasAudio: boolean;
    hasCamera: boolean;
}) {
    track('recording_finished', props);
}

