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

export function trackEditorPageLoaded(workspaceId: string | null, projectId: string) {
    trackEvent('editor_page_loaded', { workspace_id: workspaceId, project_id: projectId });
}

export function trackDashboardPageLoaded(workspaceId: string | null) {
    trackEvent('dashboard_page_loaded', { workspace_id: workspaceId });
}

export function trackBillingPageLoaded(workspaceId: string | null) {
    trackEvent('billing_page_loaded', { workspace_id: workspaceId });
}

export function trackMembersPageLoaded(workspaceId: string | null) {
    trackEvent('members_page_loaded', { workspace_id: workspaceId });
}

export function trackGeneralSettingsPageLoaded(workspaceId: string | null) {
    trackEvent('general_settings_page_loaded', { workspace_id: workspaceId });
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

// ============================================================================
// Trial Extension (billing revamp Step 3)
// ============================================================================

export function trackTrialExtended(workspaceId: string | null) {
    trackEvent('trial_extended', { workspace_id: workspaceId });
}

export function trackTrialExtendFailed(workspaceId: string | null) {
    trackEvent('trial_extend_failed', { workspace_id: workspaceId });
}

export function trackTrialReviewModalReviewClicked() {
    trackEvent('trial_review_modal_review_clicked');
}

export function trackTrialReviewModalDismissed() {
    trackEvent('trial_review_modal_dismissed');
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
    phase: 'no_id' | 'extension' | 'no_workspace';
    bridge_status?: string;
}) {
    trackEvent('import_failed', params);
}

export function trackProjectCreationFailed(params: BaseFailureParams & {
    recording_id: string | null;
    screen_video_size?: number;
    camera_video_size?: number;
    mic_audio_size?: number;
}) {
    trackEvent('project_creation_failed', params);
}

