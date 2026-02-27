/**
 * @fileoverview Analytics Integration (GA4 + Mixpanel)
 * 
 * GA4 is loaded via gtag.js in index.html.
 * Mixpanel is initialized here via the npm SDK.
 * All events are dual-tracked to both platforms.
 * 
 * ⚠️  When adding or modifying events/properties, update ./mixpanel-events.md
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
 * Update plan type on the Mixpanel profile.
 * Called from useUserStore.setSubscription so trial users
 * get their plan type set on first load (not just via webhook).
 */
export function updatePlanType(status: string | null) {
    const planType = status === 'active' ? 'pro' : status === 'trialing' ? 'pro_trial' : 'basic';
    mixpanel.people.set({ current_plan_type: planType });
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
    // Export context
    quality: '480p' | '720p' | '1080p' | '2K' | '4K';
    fps: 30 | 60;
    export_type: ExportType;
    is_authenticated: boolean;
    is_pro: boolean;
    export_duration_seconds: number;
    upload_duration_seconds?: number;

    // Recording context
    recording_type: 'tab' | 'window' | 'screen';
    input_duration: number;
    output_duration: number;
    first_url: string | null;

    // Event counts
    events_clicks: number;
    events_keyboard: number;
    events_typing: number;
    events_drags: number;
    events_hovered_cards: number;
    events_url_changes: number;

    // Screen settings
    screen_mode: 'device' | 'border';
    screen_border_radius: number;
    screen_padding: number;
    screen_device_frame_id: string | null;
    screen_toolbar_enabled: boolean;
    output_crop: string;

    // Camera settings
    has_camera: boolean;
    camera_shape: string | null;
    camera_feather: boolean;

    // Background
    background_type: 'color' | 'preset' | 'custom';
    background_color_mode: 'gradient' | 'solid';
    background_image_choice: string | null;

    // Audio
    music_enabled: boolean;
    music_choice: string | null;
    mic_muted: boolean;
    screen_audio_muted: boolean;

    // Effects
    click_effect_enabled: boolean;
    click_sound_enabled: boolean;
    drag_effect_enabled: boolean;
    hotkeys_enabled: boolean;

    // Timeline features
    zoom_count: number;
    spotlight_count: number;
    caption_count: number;
    captions_generated: boolean;
    captions_visible: boolean;
    auto_cut_used: boolean;

    // Outcome
    success: boolean;
    error?: string;
}

/**
 * Extract project-level properties for the export_completed event.
 * Keeps ExportSettings.tsx clean — just pass the project object.
 */
import type { Project } from '../../types';
import { TimeMapper } from '../mappers/timeMapper';

export function extractProjectProperties(project: Project): Omit<ExportCompletedParams,
    'quality' | 'fps' | 'export_type' | 'is_authenticated' | 'is_pro' | 'export_duration_seconds' | 'upload_duration_seconds' | 'success' | 'error'
> {
    const { settings, timeline, userEvents, screenSource } = project;
    const timeMapper = new TimeMapper(timeline.outputWindows);

    // Derive background image choice
    let background_image_choice: string | null = null;
    if (settings.background.type === 'preset' && settings.background.imageUrl) {
        // Extract filename from the preset URL as the choice name
        const parts = settings.background.imageUrl.split('/');
        background_image_choice = parts[parts.length - 1]?.split('.')[0] ?? null;
    } else if (settings.background.type === 'custom') {
        background_image_choice = 'custom';
    }

    // Derive music choice
    let music_choice: string | null = null;
    if (settings.audio.music.enabled) {
        if (settings.audio.music.source === 'preset' && settings.audio.music.presetName) {
            music_choice = settings.audio.music.presetName;
        } else if (settings.audio.music.source === 'custom') {
            music_choice = 'custom';
        }
    }

    // Shorten first URL to hostname
    let first_url: string | null = null;
    if (userEvents.urlChanges.length > 0) {
        try {
            first_url = new URL(userEvents.urlChanges[0].url).hostname;
        } catch {
            first_url = userEvents.urlChanges[0].url;
        }
    }

    return {
        // Recording context
        recording_type: screenSource.recordingType,
        input_duration: Math.round(timeline.durationMs / 1000),
        output_duration: Math.round(timeMapper.outputDuration / 1000),
        first_url,

        // Event counts
        events_clicks: userEvents.mouseClicks.length,
        events_keyboard: userEvents.keyboardEvents.length,
        events_typing: userEvents.typingEvents.length,
        events_drags: userEvents.drags.length,
        events_hovered_cards: userEvents.hoveredCards.length,
        events_url_changes: userEvents.urlChanges.length,

        // Screen settings
        screen_mode: settings.screen.mode,
        screen_border_radius: settings.screen.borderRadiusPx,
        screen_padding: settings.screen.padding,
        screen_device_frame_id: settings.screen.mode === 'device' ? (settings.screen.deviceFrameId ?? null) : null,
        screen_toolbar_enabled: settings.screen.toolbar.enabled,
        output_crop: settings.screen.outputCrop ?? 'none',

        // Camera settings
        has_camera: !!project.cameraSource,
        camera_shape: settings.camera?.shape ?? null,
        camera_feather: settings.camera?.hasFeather ?? false,

        // Background
        background_type: settings.background.type,
        background_color_mode: settings.background.colorMode,
        background_image_choice,

        // Audio
        music_enabled: settings.audio.music.enabled,
        music_choice,
        mic_muted: settings.audio.muteMicrophone,
        screen_audio_muted: settings.audio.muteScreenAudio,

        // Effects
        click_effect_enabled: settings.mouse.mouseClickEnabled,
        click_sound_enabled: settings.mouse.soundEnabled,
        drag_effect_enabled: settings.mouse.mouseDragEnabled,
        hotkeys_enabled: settings.keyboard.showHotkeys,

        // Timeline features
        zoom_count: timeline.zoomSegments.length,
        spotlight_count: timeline.spotlightSegments.length,
        caption_count: timeline.captionSegments.length,
        captions_generated: !!settings.captions.generatedAt,
        captions_visible: settings.captions.visible,
        auto_cut_used: settings.autoCutApplied ?? false,
    };
}

export function trackExportCompleted(params: ExportCompletedParams) {
    trackEvent('export_completed', params);
}

// ============================================================================
// Upgrade Funnel Events
// ============================================================================

export function trackUpgradeModalViewed() {
    trackEvent('upgrade_modal_viewed');
}

export function trackUpgradeModalDismissed() {
    trackEvent('upgrade_modal_dismissed');
}

export function trackGetProClicked(billingInterval: 'monthly' | 'yearly') {
    trackEvent('get_pro_clicked', { billing_interval: billingInterval });
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
    success: boolean;
    error?: string;
}

export function trackProjectCreated(params: ProjectCreatedParams) {
    const totalProjectsCreated = incrementProjectCount();
    trackEvent('project_created', { ...params, total_projects_created: totalProjectsCreated });
}

export function trackExtensionInstalled() {
    trackEvent('extension_installed', {});
}

export function trackExtensionUninstalled() {
    trackEvent('extension_uninstalled', {});
}

