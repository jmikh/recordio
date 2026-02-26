/**
 * @fileoverview Analytics Integration (GA4 + Mixpanel)
 * 
 * GA4 is loaded via gtag.js in index.html.
 * Mixpanel is initialized here via the npm SDK.
 * All events are dual-tracked to both platforms.
 */

import mixpanel from 'mixpanel-browser';

// Declare gtag on window
declare global {
    interface Window {
        gtag: (...args: any[]) => void;
    }
}

// ============================================================================
// Mixpanel Initialization
// ============================================================================

mixpanel.init('773bc18d036f7f77ec70ec94e7eec508', {
    autocapture: false,
    record_sessions_percent: 0,
});

// ============================================================================
// Anonymous Local User ID (GA4 only — Mixpanel uses identify/reset)
// ============================================================================

const LOCAL_USER_ID_KEY = 'recordio-local-user-id';

function getOrCreateLocalUserId(): string {
    let id = localStorage.getItem(LOCAL_USER_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(LOCAL_USER_ID_KEY, id);
    }
    return id;
}

// ============================================================================
// Mixpanel User Identity
// ============================================================================

/**
 * Identify the user in Mixpanel with their Supabase user ID.
 * Called from useUserStore.setUser on login and session restore.
 * Merges any anonymous events into the identified profile.
 */
export function identifyUser(userId: string, email: string) {
    mixpanel.identify(userId);
    mixpanel.people.set({ $email: email });
    // Set signup_date only once (won't overwrite on subsequent sessions)
    mixpanel.people.set_once({ signup_date: new Date().toISOString() });
}

/**
 * Reset Mixpanel to anonymous state.
 * Called from useUserStore.clearUser on sign-out.
 */
export function resetUser() {
    mixpanel.reset();
}

// ============================================================================
// Event Tracking (dual: GA4 + Mixpanel)
// ============================================================================

function trackEvent(eventName: string, params: Record<string, any> = {}) {
    // GA4
    if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, {
            local_user_id: getOrCreateLocalUserId(),
            ...params,
        });
    }

    // Mixpanel
    mixpanel.track(eventName, params);

    // Update last active date on every event
    mixpanel.people.set({ last_active_date: new Date().toISOString() });
}

// ============================================================================
// Public API - Specific Event Tracking Functions
// ============================================================================

export type ExportType = 'download' | 'publish';

export interface ExportCompletedParams {
    quality: '480p' | '720p' | '1080p' | '2K' | '4K';
    fps: 30 | 60;
    duration_seconds: number;
    export_type: ExportType;
    is_authenticated: boolean;
    is_pro: boolean;
}

export function trackExportCompleted(params: ExportCompletedParams) {
    trackEvent('export_completed', params);
    mixpanel.people.increment('total_exports');
}

export interface CaptionsGeneratedParams {
    segment_count: number;
    is_authenticated: boolean;
    is_pro: boolean;
}

export function trackCaptionsGenerated(params: CaptionsGeneratedParams) {
    trackEvent('captions_generated', params);
}

// ============================================================================
// Project Created
// NOTE: Browser, browser version, and OS are auto-collected by GA4 via gtag.js
// as default dimensions — no need to send them explicitly.
// ============================================================================

const PROJECTS_CREATED_KEY = 'recordio-total-projects-created';

function incrementProjectCount(): number {
    const current = parseInt(localStorage.getItem(PROJECTS_CREATED_KEY) ?? '0', 10);
    const next = current + 1;
    localStorage.setItem(PROJECTS_CREATED_KEY, String(next));
    return next;
}

export interface ProjectCreatedParams {
    duration_seconds: number;
    microphone_on: boolean;
    webcam_on: boolean;
    has_system_audio: boolean;
    first_url: string | null;
    recording_type: 'tab' | 'window' | 'screen';
    user_id: string | null;
    user_event_count: number;
    has_click_events: boolean;
    has_keyboard_events: boolean;
    has_typing_events: boolean;
    has_drag_events: boolean;
    has_hovered_cards: boolean;
    auto_zoom_count: number;
    auto_spotlight_count: number;
    screen_frame_rate: number | null;
    camera_frame_rate: number | null;
}

export function trackProjectCreated(params: ProjectCreatedParams) {
    const totalProjectsCreated = incrementProjectCount();
    trackEvent('project_created', { ...params, total_projects_created: totalProjectsCreated });
    mixpanel.people.increment('total_projects_created');
}

