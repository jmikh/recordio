import mixpanel from 'mixpanel-browser';
import { getImpersonation } from '../auth/impersonation';

// ============================================================================
// Mixpanel Initialization
// ============================================================================

const IS_PRODUCTION = import.meta.env.MODE === 'production';

/**
 * While an admin is impersonating a target user, Mixpanel must stay completely
 * inert — no events and no identity changes. Otherwise the admin's actions
 * would be attributed to the target's profile (and identifyUser would re-point
 * the admin's own distinct_id at the target). Suppressing everything leaves
 * Mixpanel exactly as it was before impersonation started.
 */
function isImpersonating(): boolean {
    return getImpersonation() !== null;
}

let mixpanelReady = false;

try {
    mixpanel.init('773bc18d036f7f77ec70ec94e7eec508', {
        opt_out_tracking_by_default: !IS_PRODUCTION,
        // Same-origin proxy is not enough on its own: `/mp/track/` is the path
        // Mixpanel's proxy docs recommend, so filter lists match it literally and
        // Brave Shields "Aggressive" blocks the request with ERR_BLOCKED_BY_CLIENT
        // before it leaves the page. The host prefix and the endpoint names are
        // both neutral here; functions/api/v2/m maps them back to Mixpanel's real
        // endpoints, so these MUST stay in sync with ROUTE_ALIASES there.
        api_host: '/api/v2/m',
        api_routes: { track: 'e', engage: 'p', groups: 'g' },
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
    if (isImpersonating()) return;
    mixpanel.identify(email);
}

// TODO: Move these engage calls to the backend (on-user-created or stripe-webhooks edge function)
/**
 * Set profile properties on first login. Uses set_once so values
 * are never overwritten — safe to call multiple times but should
 * only be called on actual login, not session restore.
 */
export function setUserProfileOnce(email: string) {
    if (isImpersonating()) return;
    mixpanel.people.set_once({ $email: email, signup_date: new Date().toISOString() });
}

// TODO: plan type should be set from the backend (stripe-webhooks edge function)
// Removed updatePlanType — was firing people.set on every session restore

/**
 * Reset Mixpanel to anonymous state.
 * Called from useUserStore.clearUser on sign-out.
 */
export function resetUser() {
    if (isImpersonating()) return;
    mixpanel.reset();
}

// ── Extension identity linking ───────────────────────────────────────────────
//
// The extension tracks under its own anonymous UUID and never changes it (it has
// no reliable moment to). Linking it to the signed-in user is the webapp's job:
// the import handoff hands us the extension's distinct_id, we hold onto it, and
// we emit the link once we know who the user is.

const EXTENSION_DISTINCT_ID_KEY = 'recordio-extension-distinct-id';

/**
 * Stash the extension's anonymous Mixpanel ID, handed over by the import handoff.
 *
 * Stored rather than linked on the spot because the user may not be signed in yet
 * — the import page can send them through a login redirect first. Deliberately NOT
 * cleared by resetUser(): a transient SIGNED_OUT during startup would otherwise
 * drop the link before it was ever made. linkExtensionIdentity() clears it.
 */
export function rememberExtensionDistinctId(extensionDistinctId: string) {
    try {
        localStorage.setItem(EXTENSION_DISTINCT_ID_KEY, extensionDistinctId);
    } catch { /* private mode / storage disabled — linking is best-effort */ }
}

/**
 * Link a previously stashed extension distinct_id to the signed-in user, so the
 * extension's recording events and the webapp's events land on one profile.
 *
 * Called from useUserStore.setUser (login or session restore) and from the import
 * page when the handoff arrives while already signed in — whichever happens last
 * is the one that does the work. Clears the stored ID so the link is emitted once.
 *
 * Under Simplified ID Merge the mapping is created the first time a `$device_id` and
 * a `$user_id` appear on the *same* event — `$identify`/`$anon_distinct_id` is the
 * Original ID Merge API and is ignored on ingest, so it cannot do this. We therefore
 * send one ordinary event whose `$device_id` we override with the extension's, while
 * `$user_id` stays the signed-in user. Same batcher, same /api/v2/m proxy as every
 * other event. Overriding `$device_id` here is safe: the webapp's own device is
 * already mapped to this user by every other event it sends.
 *
 * mixpanel.identify() cannot stand in for this — it can only ever link the SDK's own
 * previous distinct_id, not a third ID originating elsewhere.
 */
export function linkExtensionIdentity(email: string) {
    if (isImpersonating()) return;

    let extensionDistinctId: string | null = null;
    try {
        extensionDistinctId = localStorage.getItem(EXTENSION_DISTINCT_ID_KEY);
    } catch { return; }
    if (!extensionDistinctId) return;

    try {
        localStorage.removeItem(EXTENSION_DISTINCT_ID_KEY);
    } catch { /* ignore — worst case the link is emitted again, which is idempotent */ }

    // Extensions that went through the old $create_alias flow already store the
    // email as their distinct_id; there is nothing to link in that case.
    if (extensionDistinctId === email) return;

    if (!IS_PRODUCTION) {
        console.log('[Analytics] extension_linked', { $device_id: extensionDistinctId, $user_id: email });
        return;
    }
    try {
        mixpanel.track('extension_linked', {
            $device_id: extensionDistinctId,
            // Both are already in persistence from identifyUser(), but the merge depends
            // on them, so don't rely on call ordering to put them there.
            $user_id: email,
            distinct_id: email,
        });
    } catch (e) {
        console.error('[Analytics] Mixpanel extension_linked failed:', e);
    }
}

// ============================================================================
// Event Tracking
// ============================================================================

function trackEvent(eventName: string, params: Record<string, any> = {}) {
    if (isImpersonating()) return;
    if (!IS_PRODUCTION) {
        console.log(`[Analytics] ${eventName}`, params);
        return;
    }
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

// ============================================================================
// Upgrade Funnel Events
// ============================================================================

/** Stable analytics buckets for the upgrade modal — NOT the UI copy in `feature`. */
export type UpgradeModalReason =
    | 'captions'
    | 'share'
    | 'export'
    | 'export_4k'
    | 'background_export'
    | 'restore';

export function trackUpgradeModalViewed(reason: UpgradeModalReason) {
    trackEvent('upgrade_modal_viewed', { reason });
}

export function trackUpgradeModalDismissed(reason: UpgradeModalReason) {
    trackEvent('upgrade_modal_dismissed', { reason });
}

export function trackUpgradeModalUpgradeClicked(reason: UpgradeModalReason) {
    trackEvent('upgrade_modal_upgrade_clicked', { reason });
}

export function trackGetProClicked(billingInterval: 'monthly' | 'yearly') {
    trackEvent('get_pro_clicked', { billing_interval: billingInterval });
}

export interface GenerateCaptionsParams {
    project_id: string;
    segment_count: number;
    transcription_method: 'cloud' | 'local';
    success: boolean;
    error?: string;
}

export function trackGenerateCaptions(params: GenerateCaptionsParams) {
    trackEvent('generate_captions', params);
}

export function trackGenerateCaptionsClicked(projectId: string, transcriptionMethod: 'cloud' | 'local') {
    trackEvent('generate_captions_clicked', { project_id: projectId, transcription_method: transcriptionMethod });
}

export function trackGenerateCaptionsCompleted(params: {
    project_id: string;
    video_duration_s: number;
    generate_duration_s: number;
    segment_count: number;
}) {
    trackEvent('generate_captions_completed', params);
}

export function trackGenerateCaptionsFailed(params: {
    project_id: string;
    error: string;
}) {
    trackEvent('generate_captions_failed', params);
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
    /** The user's personal default settings were applied (plans/user-default-project-settings) */
    used_personal_defaults: boolean;
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

// ============================================================================
// Screenshots (plans/screenshots)
// ============================================================================

export interface ScreenshotCreatedParams {
    capture_mode: 'visible' | 'fullPage' | 'region';
    width_px: number;
    height_px: number;
    page_host: string | null;
    user_id: string | null;
    success: boolean;
    error?: string;
}

export function trackScreenshotCreated(params: ScreenshotCreatedParams) {
    trackEvent('screenshot_created', params);
}

export function trackScreenshotEditorLoaded(workspaceId: string | null, screenshotId: string) {
    trackEvent('screenshot_editor_loaded', { workspace_id: workspaceId, screenshot_id: screenshotId });
}

export function trackScreenshotShared(params: {
    screenshot_id: string;
    share_policy: 'private' | 'workspace' | 'public';
    workspace_access: 'view' | 'edit';
}) {
    trackEvent('screenshot_shared', params);
}

export function trackScreenshotViewed(params: { slug: string; published: boolean; stale: boolean }) {
    trackEvent('screenshot_view_page_loaded', params);
}

export function trackScreenshotViewFailed(params: { slug: string; error: string; status: number | null; is_offline: boolean }) {
    trackEvent('screenshot_view_page_failed', params);
}

/** Download from the public /screenshot/{slug} page (client-side fetch of the presigned render). */
export function trackScreenshotViewDownloaded(params: { slug: string; success: boolean; error?: string }) {
    trackEvent('screenshot_view_downloaded', params);
}

/** Publishing the flattened render the public page serves failed (client-side render or upload). */
export function trackScreenshotPublishFailed(params: { screenshot_id: string; error: string; is_offline: boolean }) {
    trackEvent('screenshot_publish_failed', params);
}

export function trackScreenshotExported(params: {
    format: 'png' | 'pdf' | 'pdf-a4' | 'copy';
    screenshot_id: string;
    success: boolean;
    error?: string;
}) {
    trackEvent('screenshot_exported', params);
}

export function trackProjectOpened() {
    trackEvent('project_opened');
}

export function trackEditorPageLoaded(workspaceId: string | null, projectId: string) {
    trackEvent('editor_page_loaded', { workspace_id: workspaceId, project_id: projectId });
}

export function trackDashboardPageLoaded(workspaceId: string | null) {
    trackEvent('dashboard_page_loaded', { workspace_id: workspaceId });
}

export function trackNewRecordingClicked(workspaceId: string | null) {
    trackEvent('new_recording_clicked', { workspace_id: workspaceId });
}

export function trackWorkspaceSettingsPageLoaded(workspaceId: string | null) {
    trackEvent('workspace_settings_page_loaded', { workspace_id: workspaceId });
}

export function trackExtensionUninstalled() {
    trackEvent('extension_uninstalled', {});
}

// ============================================================================
// Leave Review Modal (unified — trial extension + export triggers)
// ============================================================================

/** What put the review modal on screen. */
export type ReviewModalTrigger = 'trial_extended' | 'export_completed';

export function trackReviewModalViewed(trigger: ReviewModalTrigger) {
    trackEvent('review_modal_viewed', { trigger });
}

export function trackReviewModalReviewClicked(trigger: ReviewModalTrigger) {
    trackEvent('review_modal_review_clicked', { trigger });
}

export function trackReviewModalAlreadyReviewedClicked(trigger: ReviewModalTrigger) {
    trackEvent('review_modal_already_reviewed_clicked', { trigger });
}

export function trackReviewModalMaybeLaterClicked(trigger: ReviewModalTrigger) {
    trackEvent('review_modal_maybe_later_clicked', { trigger });
}

// ============================================================================
// Trial Extension (billing revamp Step 3)
// ============================================================================

export function trackTrialExtended(workspaceId: string | null) {
    trackEvent('trial_extended', { workspace_id: workspaceId });
}

export function trackTrialExtendFailed(workspaceId: string | null) {
    trackEvent('trial_extend_failed', { workspace_id: workspaceId });
}

// ============================================================================
// Render & Export Events
// ============================================================================

export function trackDownloadClicked(projectId: string) {
    trackEvent('download_clicked', { project_id: projectId });
}

export function trackRenderInCloudClicked(projectId: string) {
    trackEvent('render_in_cloud_clicked', { project_id: projectId });
}

export function trackRenderLocallyClicked(projectId: string) {
    trackEvent('render_locally_clicked', { project_id: projectId });
}

export function trackPublishClicked(projectId: string) {
    trackEvent('publish_clicked', { project_id: projectId });
}

interface RenderCompletedParams {
    project_id: string;
    video_duration_s: number;
    render_duration_s: number;
    input_resolution: string;
    output_resolution: string;
    /** Selected export quality ('1080p' | '2K' | '4K') — output_resolution is the project outputSize, not the rendered size. */
    quality: string;
}

export function trackRenderLocallyCompleted(params: RenderCompletedParams) {
    trackEvent('render_locally_completed', params);
}

export function trackRenderInCloudCompleted(params: RenderCompletedParams) {
    trackEvent('render_in_cloud_completed', params);
}

interface RenderFailedBaseParams {
    project_id: string;
    error: string;
    error_name?: string;
    error_stack?: string;
    is_offline: boolean;
    video_duration_s?: number;
    input_resolution?: string;
    output_resolution?: string;
}

export function trackRenderLocallyFailed(params: RenderFailedBaseParams & {
    phase: 'loading_sounds' | 'exporting' | 'downloading';
}) {
    trackEvent('render_locally_failed', params);
}

export function trackRenderInCloudFailed(params: RenderFailedBaseParams & {
    phase: 'saving_project' | 'creating_job' | 'polling_status' | 'server_render' | 'downloading';
    job_status?: string;
    http_status?: number;
}) {
    trackEvent('render_in_cloud_failed', params);
}

export function trackUploadBackgroundClicked(projectId: string) {
    trackEvent('upload_background_clicked', { project_id: projectId });
}

export function trackUploadMusicClicked(projectId: string) {
    trackEvent('upload_music_clicked', { project_id: projectId });
}

export function trackAutocutClicked(projectId: string) {
    trackEvent('autocut_clicked', { project_id: projectId });
}

// ============================================================================
// Failure Events (mirror Sentry captures for funnel-relevant actions)
// ============================================================================

interface BaseFailureParams {
    error: string;
    error_name?: string;
    is_offline: boolean;
}

export function trackProjectLoadFailed(params: BaseFailureParams & {
    project_id: string;
    loading_status?: string;
}) {
    trackEvent('project_load_failed', params);
}

export function trackAutocutFailed(params: BaseFailureParams & { project_id: string }) {
    trackEvent('autocut_failed', params);
}

export function trackProjectDeleteFailed(params: BaseFailureParams & {
    project_id?: string;
    count?: number;
}) {
    trackEvent('project_delete_failed', params);
}

export function trackUploadBackgroundFailed(params: BaseFailureParams & {
    project_id: string;
    file_size?: number;
    file_type?: string;
}) {
    trackEvent('upload_background_failed', params);
}

export function trackUploadMusicFailed(params: BaseFailureParams & {
    project_id: string;
    file_size?: number;
    file_type?: string;
}) {
    trackEvent('upload_music_failed', params);
}

export function trackWorkspaceSeatsSetFailed(params: BaseFailureParams & {
    workspace_id: string;
    seats: number;
}) {
    trackEvent('workspace_seats_set_failed', params);
}

export function trackWorkspaceInviteFailed(params: BaseFailureParams & {
    workspace_id: string;
    role: 'viewer' | 'creator' | 'admin';
}) {
    trackEvent('workspace_invite_failed', params);
}

export function trackInviteAcceptFailed(params: BaseFailureParams) {
    trackEvent('invite_accept_failed', params);
}

export function trackCheckoutSessionFailed(params: BaseFailureParams & {
    interval: 'monthly' | 'yearly';
}) {
    trackEvent('checkout_session_failed', params);
}

export function trackSubscriptionChangeFailed(params: BaseFailureParams & {
    workspace_id: string;
    new_seats: number;
}) {
    trackEvent('subscription_change_failed', params);
}

export function trackPublishFailed(params: BaseFailureParams & { project_id: string }) {
    trackEvent('publish_failed', params);
}

export function trackSigninFailed(params: BaseFailureParams & {
    provider: string;
}) {
    trackEvent('signin_failed', params);
}

export function trackImportPageLoaded(params: { recording_id: string | null }) {
    trackEvent('import_page_loaded', params);
}

export function trackImportFailed(params: BaseFailureParams & {
    recording_id: string | null;
    phase: 'no_id' | 'extension' | 'no_workspace' | 'cap';
    /** For `phase: 'extension'`, the HandoffFailureKind — 'stall',
     *  'port-disconnected', 'stream-error' or 'metadata'. A 'stall' means the
     *  extension's MV3 service worker was most likely killed mid-transfer. */
    bridge_status?: string;
    /** How far the extension→webapp transfer got before it failed. */
    bytes_received?: number;
    total_bytes?: number;
    percent_complete?: number;
    chunks_received?: number;
    total_chunks?: number;
    /** Which media source was in flight when it died ('screen' | 'camera' | 'mic' | 'image'). */
    stalled_source?: string | null;
}) {
    trackEvent('import_failed', params);
}

/** The at-cap recovery panel was shown (revamp Step 4). */
export function trackImportProjectCapModalViewed(params: { workspace_id: string }) {
    trackEvent('import_project_cap_modal_viewed', params);
}

export function trackDeleteProjectClicked(params: {
    project_id: string;
    workspace_id: string;
}) {
    trackEvent('delete_project_clicked', params);
}

/** "Save here" on the at-cap panel — workspace_id is the destination workspace. */
export function trackSaveToWorkspaceClicked(params: { workspace_id: string }) {
    trackEvent('save_to_workspace_clicked', params);
}

export function trackUpgradeToProClicked(params: { workspace_id: string }) {
    trackEvent('upgrade_to_pro_clicked', params);
}

export function trackProjectCreationFailed(params: BaseFailureParams & {
    recording_id: string | null;
    screen_video_size?: number;
    camera_video_size?: number;
    mic_audio_size?: number;
}) {
    trackEvent('project_creation_failed', params);
}


// ── Personal default project settings (plans/user-default-project-settings) ──

export function trackPersonalSettingsPageLoaded() {
    trackEvent('personal_settings_page_loaded');
}

/** The user replaced their personal defaults — from the Personal Settings page or the editor header. */
export function trackPersonalDefaultsSaved(params: { source: 'page' | 'editor' }) {
    trackEvent('personal_defaults_saved', params);
}

/** Back to the shipped defaults (column cleared). */
export function trackPersonalDefaultsReset() {
    trackEvent('personal_defaults_reset');
}
