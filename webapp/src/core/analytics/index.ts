/**
 * @fileoverview Analytics Integration (Mixpanel)
 *
 * ⚠️  When adding or modifying events/properties, update ./mixpanel-events.md
 */

import mixpanel from 'mixpanel-browser';

// ============================================================================
// Mixpanel Initialization
// ============================================================================

const IS_PRODUCTION = import.meta.env.MODE === 'production';

let mixpanelReady = false;

try {
    mixpanel.init('773bc18d036f7f77ec70ec94e7eec508', {
        opt_out_tracking_by_default: !IS_PRODUCTION,
        api_host: '/mp',
        autocapture: false,
        record_sessions_percent: 0,
        loaded: () => {
            mixpanelReady = true;
            detectBrowser().then(browser => mixpanel.register({ real_browser: browser }));
        },
    });
} catch (e) {
    console.error('[Analytics] Mixpanel init failed:', e);
}

/** Detect actual browser — Chromium forks all report as Chrome in UA */
async function detectBrowser(): Promise<string> {
    const ua = navigator.userAgent;
    try {
        if (await (navigator as any).brave?.isBrave?.()) return 'Brave';
    } catch { /* not Brave */ }
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
    if (ua.includes('Vivaldi')) return 'Vivaldi';
    if (ua.includes('SamsungBrowser')) return 'Samsung Internet';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Chrome')) return 'Chrome';
    return 'Unknown';
}

// ============================================================================
// Mixpanel User Identity
// ============================================================================

/**
 * Identify the user in Mixpanel with their email address.
 * Called from useUserStore.setUser on login and session restore.
 * Merges any anonymous events into the identified profile.
 */
export function identifyUser(email: string) {
    mixpanel.identify(email);
}

// TODO: Move these engage calls to the backend (on-user-created or stripe-webhooks edge function)
/**
 * Set profile properties on first login. Uses set_once so values
 * are never overwritten — safe to call multiple times but should
 * only be called on actual login, not session restore.
 */
export function setUserProfileOnce(email: string) {
    mixpanel.people.set_once({ $email: email, signup_date: new Date().toISOString() });
}

// TODO: plan type should be set from the backend (stripe-webhooks edge function)
// Removed updatePlanType — was firing people.set on every session restore

/**
 * Reset Mixpanel to anonymous state.
 * Called from useUserStore.clearUser on sign-out.
 */
export function resetUser() {
    mixpanel.reset();
}

/**
 * Link the webapp's anonymous Mixpanel profile with the extension's anonymous ID.
 * Called during handoff so extension recording events merge into the same profile.
 * If the user later authenticates, identifyUser() will further merge into the Supabase ID.
 *
 * Skipped when already authenticated — identifyUser() has already set the distinct_id
 * to the Supabase ID, and calling identify(extId) would overwrite it.
 */
export function identifyExtensionUser(extensionDistinctId: string) {
    mixpanel.identify(extensionDistinctId);
}

// ============================================================================
// Event Tracking
// ============================================================================

function trackEvent(eventName: string, params: Record<string, any> = {}) {
    try {
        if (!mixpanelReady) {
            console.warn(`[Analytics] Mixpanel not ready, dropping event: ${eventName}`);
        }
        mixpanel.track(eventName, params);
    } catch (e) {
        console.error(`[Analytics] Mixpanel track failed for ${eventName}:`, e);
    }
}

// ============================================================================
// Public API - Specific Event Tracking Functions
// ============================================================================

export interface ExportCompletedParams {
    // Export context
    quality: '480p' | '720p' | '1080p' | '2K' | '4K';
    fps: number;
    export_duration_ms: number;

    // Recording context
    recording_current_window: boolean;
    input_duration_ms: number;
    output_duration_ms: number;
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
    camera_move_count: number;
    caption_count: number;
    text_overlay_count: number;
    blur_overlay_count: number;
    outline_overlay_count: number;
    arrow_overlay_count: number;
    captions_generated: boolean;
    captions_visible: boolean;
    auto_cut_used: boolean;

    // Outcome
    success: boolean;
    error?: string;

    // Codec resolution
    video_codec: string;
    video_codec_fallback: boolean;
    video_codecs_tried: string[];
    audio_codec: string;
    audio_codec_fallback: boolean;
    video_decode_mode: 'hardware' | 'software';
    video_decode_fallback: boolean;
}

/**
 * Extract project-level properties for the export_completed event.
 * Keeps ExportSettings.tsx clean — just pass the project object.
 */
import type { Project } from '@shared/types';
import { TimeMapper } from '@shared/mappers/timeMapper';

export function extractProjectProperties(project: Project): Omit<ExportCompletedParams,
    'quality' | 'fps' | 'export_type' | 'export_duration_ms' | 'upload_duration_ms' | 'success' | 'error' | 'video_codec' | 'video_codec_fallback' | 'video_codecs_tried' | 'audio_codec' | 'audio_codec_fallback' | 'video_decode_mode' | 'video_decode_fallback'
> {
    const { settings, timeline, screenSource } = project;
    const userEvents = project.userEvents ?? { mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [] };
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
        recording_current_window: !!screenSource.trackableContentRect,
        input_duration_ms: Math.round(timeline.durationMs),
        output_duration_ms: Math.round(timeMapper.outputDuration),
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
        camera_move_count: timeline.cameraMoveSegments.length,
        caption_count: timeline.captionSegments.length,
        text_overlay_count: (timeline.overlaySegments ?? []).filter(s => s.item?.type === 'text').length,
        blur_overlay_count: (timeline.overlaySegments ?? []).filter(s => s.item?.type === 'blur').length,
        outline_overlay_count: (timeline.overlaySegments ?? []).filter(s => s.item?.type === 'border').length,
        arrow_overlay_count: (timeline.overlaySegments ?? []).filter(s => s.item?.type === 'arrow').length,
        captions_generated: !!settings.captions.transcriptionSource,
        captions_visible: settings.captions.enabled ?? true,
        auto_cut_used: settings.autoCutApplied ?? false,
    };
}

export type ExportStartedParams = Omit<ExportCompletedParams,
    'export_duration_ms' | 'success' | 'error' | 'video_codec' | 'video_codec_fallback' | 'video_codecs_tried' | 'audio_codec' | 'audio_codec_fallback' | 'video_decode_mode' | 'video_decode_fallback'
> & {
    export_type: 'download' | 'publish';
};

/**
 * Fires at the start of an export so we have telemetry even if the export
 * crashes midway and never reaches export_completed.
 */
export function trackExportStarted(params: ExportStartedParams) {
    trackEvent('export_started', params);
}

export function trackExportCompleted(params: ExportCompletedParams) {
    trackEvent('export_completed', params);
}

export type VideoPublishedParams = ExportCompletedParams & {
    upload_duration_ms: number;
};

export function trackVideoPublished(params: VideoPublishedParams) {
    trackEvent('video_published', params);
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

export interface GenerateCaptionsParams {
    segment_count: number;
    transcription_method: 'cloud' | 'local';
    success: boolean;
    error?: string;
}

export function trackGenerateCaptions(params: GenerateCaptionsParams) {
    trackEvent('generate_captions', params);
}

// ============================================================================
// Project Created
// ============================================================================


export interface ProjectCreatedParams {
    duration_ms: number;
    microphone_on: boolean;
    camera_on: boolean;
    has_system_audio: boolean;
    first_url: string | null;
    recording_current_window: boolean;
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
    trackEvent('project_created', params);
}

export function trackProjectOpened() {
    trackEvent('project_opened');
}

export function trackEditorLoaded() {
    trackEvent('editor_loaded');
}

export function trackExtensionUninstalled() {
    trackEvent('extension_uninstalled', {});
}

// ============================================================================
// Review Modal
// ============================================================================

export function trackReviewModalShown() {
    trackEvent('review_modal_shown');
}

export function trackReviewModalDismissed() {
    trackEvent('review_modal_dismissed');
}

export function trackReviewModalReviewClicked() {
    trackEvent('review_modal_review_clicked');
}

