/**
 * @fileoverview Google Analytics 4 Integration via gtag.js
 * 
 * The gtag.js script is loaded in index.html. This module provides
 * typed helper functions for tracking custom events.
 */

// Declare gtag on window
declare global {
    interface Window {
        gtag: (...args: any[]) => void;
    }
}

// ============================================================================
// Anonymous Local User ID
// Persistent UUID per installation, sent with every event for user correlation.
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

function trackEvent(eventName: string, params: Record<string, any> = {}) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, {
        local_user_id: getOrCreateLocalUserId(),
        ...params,
    });
}

// ============================================================================
// Public API - Specific Event Tracking Functions
// ============================================================================

export interface ExportCompletedParams {
    quality: '480p' | '720p' | '1080p' | '2K' | '4K';
    fps: 30 | 60;
    duration_seconds: number;
    is_authenticated: boolean;
    is_pro: boolean;
}

export function trackExportCompleted(params: ExportCompletedParams) {
    trackEvent('export_completed', params);
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
}

