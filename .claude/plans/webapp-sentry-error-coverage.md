# Webapp Sentry Error Coverage Plan

Audit of every caught/swallowed error in `webapp/src`, classified by current Sentry coverage and what we should do.

## Coverage rule
- **All** caught errors that aren't intentionally silent → `Sentry.captureException` with structured scope (flow, phase, ids).
- **Some** also get a Mixpanel event — only for **funnel-relevant user actions** (export, transcribe, share, billing, project create/delete, invite). Pure infra failures (asset library load, thumbnail save, identify handoff) are Sentry-only.

## What's already covered
- **Supabase RPC** (`/rpc/*`) — `sentryFetch` reports any non-2xx (except 401/403/409/429) and network failures. Most `pages/Settings/*` and `DashboardPage` mutations are already visible to Sentry through this channel, but with no user-action tag.
- **`CloudProjectService.{saveProject, deleteProject, restoreProject, uploadMedia}`** — explicit `Sentry.captureException`.
- **Recording import** — `captureImportError` from `ImportPage` and `useExtensionBridge`.

## What's invisible to Sentry
Anything that:
1. catches an error but never calls `Sentry.captureException`, AND
2. doesn't reach `sentryFetch` via Supabase `/rpc/*` (so: Supabase `functions.invoke`, Supabase `storage.*`, direct `fetch`, browser APIs, workers, codecs).

---

## Proposed helper

Add to [webapp/src/utils/sentry.ts](webapp/src/utils/sentry.ts):

```ts
export interface ErrorContext {
    flow: string;             // e.g. 'render', 'project', 'billing', 'share'
    phase?: string;           // sub-step within the flow
    projectId?: string;
    workspaceId?: string;
    extra?: Record<string, unknown>;
}

export function captureError(error: unknown, ctx: ErrorContext) {
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.withScope((scope) => {
        scope.setTag('flow', ctx.flow);
        if (ctx.phase) scope.setTag(`${ctx.flow}.phase`, ctx.phase);
        if (ctx.projectId) scope.setTag('projectId', ctx.projectId);
        if (ctx.workspaceId) scope.setTag('workspaceId', ctx.workspaceId);
        if (ctx.extra) scope.setExtras(ctx.extra);
        scope.setExtra('isOffline', !navigator.onLine);
        Sentry.captureException(err);
    });
}
```

Use this in every catch site below.

---

## Site-by-site plan

Legend: **S** = Sentry only · **S+M** = Sentry + Mixpanel · **skip** = intentional silent (already correct)

### Render & export
| Site | Action | Notes |
|---|---|---|
| [useLocalRender.ts:94](webapp/src/editor/components/settings/useLocalRender.ts#L94) | **S+M** | Mixpanel already has `render_locally_failed`. Add `captureError({flow:'render', phase:result.phase, projectId, extra:{kind:'local'}})`. |
| [useCloudRender.ts:91](webapp/src/editor/components/settings/useCloudRender.ts#L91) (`downloadFile` outer catch) | **S+M** | Mixpanel `render_in_cloud_failed` already added. Add `captureError({flow:'render', phase:'downloading', projectId})`. |
| [useCloudRender.ts:211](webapp/src/editor/components/settings/useCloudRender.ts#L211) (`startCloudRender` outer catch) | **S+M** | `captureError({flow:'render', phase:failPhase, projectId})`. |
| [useCloudRender.ts](webapp/src/editor/components/settings/useCloudRender.ts) `data?.error` branches (creating_job, server_render) | **S+M** | Currently Mixpanel-only on `data.error`. Synthesize an Error and `captureError`. |

### Captions / transcription
| Site | Action | Notes |
|---|---|---|
| [CaptionsSettings.tsx:290](webapp/src/editor/components/settings/CaptionsSettings.tsx#L290) | **S+M** | Already fires `generate_captions_failed`. Add `captureError({flow:'transcribe', phase:engine, projectId})`. Skip if `message === 'Aborted'`. |
| [transcription.worker.ts:122](webapp/src/core/transcription/transcription.worker.ts#L122) | **S** (in main) | Worker can't import the SDK easily — keep `postMessage({type:'error'})` and have `TranscriptionService`/caller `captureError` on receive. |
| [TranscriptionService.ts:97](webapp/src/core/transcription/TranscriptionService.ts#L97) | skip | Re-throws after cleanup; caller handles. |
| [vadService.ts:227](webapp/src/core/autocut/vadService.ts#L227) | **S** | `captureError({flow:'autocut', phase:'vad_decode'})`. |
| [useAudioAnalysis.ts:85](webapp/src/editor/hooks/useAudioAnalysis.ts#L85) | **S** | `captureError({flow:'audio_analysis'})`. Currently `console.info` — likely intentional for missing audio tracks. **Filter:** only capture if not a "no audio track" decode error. |
| [TimelineToolbar.tsx:149](webapp/src/editor/components/timeline/TimelineToolbar.tsx#L149) (AutoCut) | **S+M** | Add `autocut_failed` Mixpanel event + `captureError({flow:'autocut'})`. |

### Project lifecycle (editor)
| Site | Action | Notes |
|---|---|---|
| [editor/App.tsx:135](webapp/src/editor/App.tsx#L135) (`init` catch — project load) | **S+M** | High-value. Add `project_load_failed` Mixpanel event + `captureError({flow:'project_load', phase:loadingStatus, projectId})`. Many users hit this. |
| [editor/App.tsx:132](webapp/src/editor/App.tsx#L132) (`asset library load`) | **S** | Replace `console.error` with `captureError({flow:'asset_library', phase:'load'})`. |
| [useProjectStore.ts:227](webapp/src/editor/stores/useProjectStore.ts#L227) (save catch) | **S** | `captureError({flow:'project_save', projectId})`. |
| [useProjectStore.ts:292](webapp/src/editor/stores/useProjectStore.ts#L292) (`updateProjectName.catch(console.error)`) | **S** | `.catch(e => captureError(e, {flow:'project_rename', projectId}))`. |
| [useProjectStore.ts:327](webapp/src/editor/stores/useProjectStore.ts#L327) (`saveProject.catch(console.error)`) | skip-dup | `saveProject` already calls Sentry internally. Replace console.error with no-op or `.catch(()=>{})`. |
| [useAssetLibraryStore.ts:51](webapp/src/editor/stores/useAssetLibraryStore.ts#L51) | **S** | `captureError({flow:'asset_library', phase:'load'})`. |
| [ConflictModal.tsx:37](webapp/src/editor/components/ConflictModal.tsx#L37) (load cloud) | **S** | `captureError({flow:'conflict', phase:'load_cloud', projectId})`. |
| [ConflictModal.tsx:54](webapp/src/editor/components/ConflictModal.tsx#L54) (overwrite cloud) | **S** | `captureError({flow:'conflict', phase:'overwrite', projectId})`. |
| [CanvasContainer.tsx:335](webapp/src/editor/components/canvas/CanvasContainer.tsx#L335) (`saveThumbnail.catch(console.warn)`) | **S** | `captureError({flow:'thumbnail_save', projectId})`. |
| [cloudProjectService.ts:406](webapp/src/storage/cloudProjectService.ts#L406) (thumbnail batch load) | **S** | `.catch(e => captureError(e, {flow:'thumbnail_batch_load'}))`. |
| [cloudProjectService.ts:487](webapp/src/storage/cloudProjectService.ts#L487) (thumbnail upload) | **S** | Same. |
| [cloudProjectService.ts:203](webapp/src/storage/cloudProjectService.ts#L203) (per-blob upload retry) | skip | Wrapped by outer `media_upload` Sentry capture at line 222. |

### Project lifecycle (dashboard)
DashboardPage's RPC operations are *partially* covered by sentryFetch — but only at the HTTP layer, with no user-action tag. Wrapping the catches gives us "what was the user trying to do."

| Site | Action | Notes |
|---|---|---|
| [DashboardPage.tsx:135](webapp/src/pages/DashboardPage.tsx#L135) (load projects+folders) | **S** | `captureError({flow:'dashboard_load', workspaceId})`. |
| [DashboardPage.tsx:268](webapp/src/pages/DashboardPage.tsx#L268) (create workspace) | **S+M** | Funnel-relevant. Add `workspace_create_failed` + `captureError({flow:'workspace', phase:'create'})`. |
| [DashboardPage.tsx:279](webapp/src/pages/DashboardPage.tsx#L279) (create folder) | **S** | `captureError({flow:'folder', phase:'create', workspaceId})`. |
| [DashboardPage.tsx:292](webapp/src/pages/DashboardPage.tsx#L292) (update folder) | **S** | `captureError({flow:'folder', phase:'update'})`. |
| [DashboardPage.tsx:312](webapp/src/pages/DashboardPage.tsx#L312) (delete folder) | **S** | `captureError({flow:'folder', phase:'delete'})`. |
| [DashboardPage.tsx:341](webapp/src/pages/DashboardPage.tsx#L341) (rename project) | **S** | `captureError({flow:'project', phase:'rename', projectId})`. |
| [DashboardPage.tsx:354](webapp/src/pages/DashboardPage.tsx#L354) (star project) | **S** | `captureError({flow:'project', phase:'star', projectId})`. |
| [DashboardPage.tsx:369](webapp/src/pages/DashboardPage.tsx#L369) (move to folder) | **S** | `captureError({flow:'project', phase:'move'})`. |
| [DashboardPage.tsx:384](webapp/src/pages/DashboardPage.tsx#L384) (delete project) | **S+M** | Add `project_deleted_failed`. |
| [DashboardPage.tsx:406](webapp/src/pages/DashboardPage.tsx#L406) (bulk delete) | **S+M** | Same event name, `extra:{count}`. |

### Settings — backgrounds & music
| Site | Action | Notes |
|---|---|---|
| [BackgroundSettings.tsx:132](webapp/src/editor/components/settings/BackgroundSettings.tsx#L132) (select bg) | **S** | `captureError({flow:'background', phase:'select', projectId})`. |
| [BackgroundSettings.tsx:144](webapp/src/editor/components/settings/BackgroundSettings.tsx#L144) (delete bg) | **S** | `captureError({flow:'background', phase:'delete'})`. |
| [BackgroundSettings.tsx:160](webapp/src/editor/components/settings/BackgroundSettings.tsx#L160) (upload bg) | **S+M** | We track `upload_background_clicked` but not failures. Add `upload_background_failed` + Sentry. |
| [AudioSettings.tsx:141](webapp/src/editor/components/settings/AudioSettings.tsx#L141) (select music) | **S** | `captureError({flow:'music', phase:'select'})`. |
| [AudioSettings.tsx:156](webapp/src/editor/components/settings/AudioSettings.tsx#L156) (upload music) | **S+M** | Add `upload_music_failed` + Sentry. |
| [AudioSettings.tsx:113,460](webapp/src/editor/components/settings/AudioSettings.tsx#L113) (`audio.play().catch`) | skip | Browser autoplay rejection — expected. |
| [useBackgroundMusic.ts:53,86](webapp/src/editor/hooks/useBackgroundMusic.ts#L53) (`audio.play().catch`) | skip | Same. |
| [CanvasContainer.tsx:556](webapp/src/editor/components/canvas/CanvasContainer.tsx#L556) (`media.play().catch`) | skip | Same. |

### Workspace / members / billing
| Site | Action | Notes |
|---|---|---|
| [MembersPage.tsx:155](webapp/src/pages/Settings/MembersPage.tsx#L155) (update role) | **S** | `captureError({flow:'workspace', phase:'role_update'})`. |
| [MembersPage.tsx:314](webapp/src/pages/Settings/MembersPage.tsx#L314) (set seats) | **S+M** | Funnel — add `workspace_seats_set_failed`. |
| [MembersPage.tsx:343](webapp/src/pages/Settings/MembersPage.tsx#L343) (invite) | **S+M** | Add `workspace_invite_failed`. |
| [MembersPage.tsx:360](webapp/src/pages/Settings/MembersPage.tsx#L360) (remove member) | **S** | |
| [MembersPage.tsx:376](webapp/src/pages/Settings/MembersPage.tsx#L376) (rescind invite) | **S** | |
| [MembersPage.tsx:393](webapp/src/pages/Settings/MembersPage.tsx#L393) (resend invite) | **S** | |
| [WorkspaceSettingsPage.tsx:42](webapp/src/pages/Settings/WorkspaceSettingsPage.tsx#L42) | **S** | |
| [GeneralPage.tsx:31](webapp/src/pages/Settings/GeneralPage.tsx#L31) | **S** | |
| [AcceptInvitePage.tsx:32](webapp/src/pages/AcceptInvitePage.tsx#L32) | **S+M** | Add `invite_accept_failed`. Funnel-critical. |
| [StripeService.ts:67](webapp/src/editor/stripe/StripeService.ts#L67) (checkout) | **S+M** | Add `checkout_session_failed` (we already track `get_pro_clicked` — knowing how often checkout dies is gold). |
| [StripeService.ts:100](webapp/src/editor/stripe/StripeService.ts#L100) (subscription change) | **S+M** | Add `subscription_change_failed`. |
| [StripeService.ts:134](webapp/src/editor/stripe/StripeService.ts#L134) (portal) | **S** | |

### Share / publish
| Site | Action | Notes |
|---|---|---|
| [Header.tsx:112](webapp/src/editor/components/header/Header.tsx#L112) (clipboard write) | skip | Browser permission denial — UI already toasts. Optional Sentry if we want to measure it. |
| [Header.tsx:138](webapp/src/editor/components/header/Header.tsx#L138) (share/publish outer catch) | **S+M** | Add `publish_failed`. We track `publish_clicked` already. |
| [Header.tsx:136](webapp/src/editor/components/header/Header.tsx#L136) (`mux-video-create.catch(console.error)`) | **S** | `captureError({flow:'publish', phase:'mux_create', projectId})`. |

### Auth
| Site | Action | Notes |
|---|---|---|
| [AuthManager.ts:22,59,75,109](webapp/src/auth/AuthManager.ts#L22) | skip | All localStorage parsing / `Notification` fallbacks — intentional. |
| [AuthManager.ts:297](webapp/src/auth/AuthManager.ts#L297) (OAuth) | **S+M** | Add `signin_failed` with `provider`. |

### Background upload / media
| Site | Action | Notes |
|---|---|---|
| [useBackgroundUpload.ts:45](webapp/src/hooks/useBackgroundUpload.ts#L45) | skip-dup | `CloudProjectService.uploadMedia` already calls Sentry internally (line 222). Don't double-fire. |
| [useExtensionBridge.ts:281](webapp/src/hooks/useExtensionBridge.ts#L281) | skip | Already uses `captureImportError`. |
| [useExtensionBridge.ts:437](webapp/src/hooks/useExtensionBridge.ts#L437) (confirmHandoff) | **S** | `captureError({flow:'import', phase:'confirm_handoff'})`. |
| [useExtensionBridge.ts:450](webapp/src/hooks/useExtensionBridge.ts#L450) (sendIdentify) | skip | Fire-and-forget analytics handoff — comment says "should never block". |
| [useExtensionBridge.ts:416](webapp/src/hooks/useExtensionBridge.ts#L416), [:93](webapp/src/hooks/useExtensionBridge.ts#L93) | skip | Re-throws via `reject`, caller handles. |

### Always-silent (skip, already correct)
- [core/analytics/index.ts:22,31,102](webapp/src/core/analytics/index.ts#L22) — mixpanel init/detect/track guard. Analytics should never throw.
- [storage/localPreferences.ts:39](webapp/src/storage/localPreferences.ts#L39) — JSON.parse fallback to default.
- [supabase/sentryFetch.ts:54](webapp/src/supabase/sentryFetch.ts#L54) — JSON parse for body extraction inside Sentry handler.
- [pages/ImportPage.tsx:186,213,224,251](webapp/src/pages/ImportPage.tsx#L186) — URL parse + analytics guards (commented `analytics should never break the app`).
- [editor/components/canvas/CanvasOverlayEditor.tsx:303,346,503,614](webapp/src/editor/components/canvas/CanvasOverlayEditor.tsx#L303) — `releasePointerCapture` noops (browser quirk).
- [editor/components/canvas/bounding-box/BoundingBox.tsx:199](webapp/src/editor/components/canvas/bounding-box/BoundingBox.tsx#L199) — verify it's a noop pattern.
- [storage/blobCache.ts:141](webapp/src/storage/blobCache.ts#L141) — likely cache eviction noop, verify.
- [editor/stores/useAssetLibraryStore.ts:49,62](webapp/src/editor/stores/useAssetLibraryStore.ts#L49) — `resolveBlobUrl` background fetch; verify.

---

## Summary of new Mixpanel events to add
1. `project_load_failed`
2. `autocut_failed`
3. `workspace_create_failed`
4. `project_deleted_failed`
5. `upload_background_failed`
6. `upload_music_failed`
7. `workspace_seats_set_failed`
8. `workspace_invite_failed`
9. `invite_accept_failed`
10. `checkout_session_failed`
11. `subscription_change_failed`
12. `publish_failed`
13. `signin_failed`

All include `error`, `error_name`, `is_offline`, plus a flow-specific id (`project_id`, `workspace_id`, `provider`, etc.).

## Implementation order
1. Add `captureError` helper in `utils/sentry.ts`.
2. Wire it through render paths (already touched today — fastest).
3. Settings & upload flows (high-value, low risk).
4. Dashboard / workspace mutations.
5. Stripe & auth.
6. Add the 13 new Mixpanel events alongside.

## Open questions for you
- **Editor → asset library load failure** — Mixpanel too? (Could indicate CDN-region issues like the Jakarta render fail.)
- **Conflict modal failures** — these are rare but high-impact (data loss risk). Worth a Mixpanel event?
- **`audio.play().catch(() => {})` in `AudioSettings` previews** — confirm skip (autoplay policy), or do you want to Sentry-track to see how often previews are blocked?
- **`useAudioAnalysis`** — currently `console.info` for "no audio track". Should we differentiate "intentional silence" from "decode actually failed"?
