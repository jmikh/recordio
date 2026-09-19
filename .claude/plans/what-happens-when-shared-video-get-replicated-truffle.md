# Self-healing shared video: auto-render, live progress, dark player slot

## Context

`POST /shared-video-get` ([sharedVideoGet.ts](server/src/routes/sharedVideoGet.ts)) is the only call the
public watch page makes. Today it is purely a reader: it looks up `mux_videos` for the project and maps
the result to one of four states — `completed` (plays), `pending` (opaque spinner), `failed` (a dead end),
or **no status at all**, which the page renders as "Could not find video".

Three problems follow from that:

1. **A shared link can be permanently dead.** If the project has no `mux_videos` row (never published, the
   publish call never fired, the row was swept by the daily purge in
   [muxVideosPurgeSuperseded.ts](server/src/jobs/muxVideosPurgeSuperseded.ts)), the viewer sees "Could not
   find video" forever. Nothing on the page can fix it; only the owner re-opening the share modal can.
   The render is reproducible from `project_data` — the page should just start it.
2. **`pending` is opaque.** `render_jobs.progress` (0→1, refreshed by the worker's ~5s heartbeat) already
   exists and is already polled by the editor's export UI
   ([useCloudRender.ts](webapp/src/editor/components/settings/useCloudRender.ts)), but
   `SharedVideoGetResponse` carries no percentage and `/render-job-get-status` is editor-gated, so an
   anonymous viewer can never see it.
3. **Failure has no exit.** The `failed` placeholder says "Please try sharing again." — advice a viewer who
   is not the owner cannot act on — with no support path, unlike every other terminal failure in the app.

Plus a visual issue: `PlayerPlaceholder` uses `bg-surface-body`, which is near-white in light mode. The
box that stands where a video will be should read as a video surface, not as page background.

**Outcome:** opening a shared link always either plays the video, shows a live render percentage, or shows
one honest failure with a way to reach support — and the player slot is a dark 16:9 box from the first
frame, including during the initial fetch.

## Decisions taken (from the clarifying questions)

- **Retry budget, not an IP budget.** Auto-start is bounded per project by an attempt counter: up to
  **5 attempts**, after which a new attempt is only allowed once **1 hour** has passed since the last one.
  Exhausted budget → the viewer sees "Something went wrong" + contact support. The render dispatch is the
  expensive, persistently-failing part, so `render_jobs.attempt_count` is the counter that matters.
- **No entitlement gate on auto-start.** Unlike `/mux-video-create`, the auto-start does **not** check
  `canShare`. The link is already public; honour it.
- **Chrome + dark placeholder during the initial fetch** — the full-screen `LoadingLogo` goes away on this
  page; the shell renders immediately with a dark placeholder in the player slot.
- **A new `--surface-media` token** rather than raw `bg-black`, per the ui-guidelines "semantic tokens
  only" rule.

### Two counters, because one isn't enough

**Primary: `render_jobs.attempt_count`.** This is the render dispatch counter and the thing worth capping —
every increment is another 2K render on the worker. It is already maintained with no new writer:
[renderJobs.ts:97](server/src/services/renderJobs.ts#L97) bumps it each time the get-or-create CTE resets a
`failed`/`canceled` job, and `updated_at` moves with it. A render that keeps failing (bad media, a crashing
worker, a project the renderer chokes on) burns exactly 5 dispatches and then trickles at 1/hour.

**Secondary: `mux_videos.attempt`**, for the one failure mode the render counter cannot see. Mux's
`video.asset.errored` webhook ([muxVideoWebhook.ts:125-144](server/src/routes/muxVideoWebhook.ts#L125-L144))
marks `mux_videos` failed while the render job stays `completed`. A retry then hits the render cache —
`getOrCreateRenderJob` returns `is_new: false`, `attempt_count` never moves — and `uploadToMux` runs again,
creating a **new Mux asset every 5 seconds**, forever. Cheap in render terms, not cheap at Mux, and it leaks
assets. So the publish upsert also bumps `mux_videos.attempt` (the column exists, `INTEGER NOT NULL DEFAULT
1`, and is currently dead — nothing writes it).

**When each counter moves.** Neither failure cascade touches `attempt` —
[renderJobWebhook.ts:176-186](server/src/routes/renderJobWebhook.ts#L176-L186) and
[cron_render_stale_jobs.sql:36-44](supabase/sql/crons/cron_render_stale_jobs.sql#L36-L44) only set
`status` / `error` / `updated_at`. Both counters are incremented one step later, by the **next dispatch**,
in the same request: `renderJobs.ts`'s retried branch bumps `attempt_count`, the publish upsert bumps
`attempt`.

| Event | `render_jobs.attempt_count` | `mux_videos.attempt` |
|---|---|---|
| Dispatch #1 (fresh rows) | 1 (INSERT default) | 1 (INSERT default) |
| Render fails → cascade marks mux `failed` | 1 | 1 |
| Dispatch #2 (retry) | 2 | 2 |
| … through dispatch #5, render fails | 5 | 5 |
| Next poll | **blocked** by the render counter | — |

So in the render-failure path the two stay in lockstep and the render counter is what trips — exactly 5
dispatches, then 1 per hour. They diverge only in the Mux-errored case, where the render CTE returns a
cache hit (`is_new: false`, `attempt_count` frozen at 1) while the mux upsert still climbs to 5.

**The gate blocks when *either* counter is exhausted** — `>= 5` with that row's own `updated_at` inside the
last hour.

### One risk, flagged not fixed

With no per-IP cap on the trigger path, a bot walking many public slugs can start one 2K render per
project it finds (each bounded to 5, then 1/hour). The existing 60 req/min per-IP limit is the only
fan-out guard. If this shows up in render-worker load, the cheap mitigation is a second, much stricter
in-memory bucket applied **only** when the handler actually dispatches — the pattern is already in the
file. Not built now.

---

## Server

### 1. Extract the publish path — `server/src/services/sharedVideoPublish.ts` (new)

[muxVideoCreate.ts:111-190](server/src/routes/muxVideoCreate.ts#L111-L190) is exactly the work the
auto-start needs, sitting inside an authenticated route. Move it verbatim into a service:

```ts
export async function publishProjectToMux(
    deps: Pick<Deps, 'db' | 'clock' | 's3' | 'mux' | 'renderWorker'>,
    opts: { projectId: string; ownerId: string; cloudVersion: number; statusCallbackUrl: string; log: WarnSink },
): Promise<{ muxVideoId: string; status: string; isNew: boolean }>
```

Body = the existing upsert → `getOrCreateRenderJob({ quality: MUX_RENDER_QUALITY })` → cache-hit
`uploadToMux` → `markMuxVideoFailed('Render dispatch failed')`-on-throw chain, unchanged. One addition:
the `ON CONFLICT … DO UPDATE` gains `attempt = mux_videos.attempt + 1` alongside the existing resets, so
every retry that actually resets a row costs a token from the budget. (The `WHERE mux_videos.status NOT IN
('completed','pending')` guard still means completed/pending rows are never touched.)

`muxVideoCreate.ts` keeps its `requireUser` → editor check → `canShare` gate and then calls the service.
Its existing tests are the parity harness — they must pass unchanged apart from the new `attempt` value.

### 2. `sharedVideoGet.ts` — progress, then auto-start

**Registration.** [app.ts:184](server/src/app.ts#L184) registers the route above the `statusCallbackUrl`
computation at [app.ts:196](server/src/app.ts#L196). Move the `app.register(sharedVideoGetRoutes)` line
below it and pass `{ statusCallbackUrl }`, mirroring `muxVideoCreateRoutes`. Give the plugin the same
`opts.statusCallbackUrl` guard muxVideoCreate has.

**Project query** ([sharedVideoGet.ts:84-94](server/src/routes/sharedVideoGet.ts#L84-L94)) gains
`cloud_version` and `upload_status`.

**Mux query** ([:122-128](server/src/routes/sharedVideoGet.ts#L122-L128)) keeps its `DISTINCT ON (status)`
shape and gains the render join, so a pending row arrives with its percentage in the same round trip:

```sql
SELECT DISTINCT ON (mv.status)
       mv.status, mv.mux_playback_id, rj.progress AS render_progress
FROM mux_videos mv
LEFT JOIN render_jobs rj
       ON rj.project_id = mv.project_id
      AND rj.cloud_version = mv.cloud_version
      AND rj.quality = $2            -- MUX_RENDER_QUALITY
WHERE mv.project_id = $1
ORDER BY mv.status, mv.cloud_version DESC
```

Join by `(project_id, cloud_version, quality)` — the derivation every other reader already uses
(`renderJobWebhook.ts:187`, both stale-job crons). `mux_videos.render_job_id` exists and is backfilled but
has no writers; wiring it up is the separate "Render/Mux simplification Step 2" and stays out of scope.

**Resolution order** replacing [:148-168](server/src/routes/sharedVideoGet.ts#L148-L168):

1. `completed` with a playback id → unchanged (`status: 'completed'`, `muxPlaybackId`, `captions`).
2. `pending` → `{ status: 'pending', ...(render_progress != null && { progress: render_progress }) }`.
   No progress key = still queued; `progress === 1` = rendered, waiting on the Mux webhook.
3. Otherwise (only failed rows, or nothing at all) → the **auto-start branch**. One extra query for the
   current version's state, since that pair of rows is what the upsert and the render CTE will target:
   ```sql
   SELECT mv.status      AS mux_status,
          mv.attempt     AS mux_attempt,
          mv.updated_at  AS mux_updated_at,
          rj.attempt_count,
          rj.updated_at  AS render_updated_at
   FROM (SELECT $1::uuid AS project_id, $2::int AS cloud_version) k
   LEFT JOIN mux_videos mv
          ON mv.project_id = k.project_id AND mv.cloud_version = k.cloud_version
   LEFT JOIN render_jobs rj
          ON rj.project_id = k.project_id AND rj.cloud_version = k.cloud_version
         AND rj.quality = $3
   ```
   Then, in order:
   - `mux_status = 'completed'` (playback id hasn't landed) → `{ status: 'pending' }`. No dispatch.
   - `project.upload_status !== 'ready'` → return `base` ("Could not find video"). The media isn't in
     storage; a render would only fail. No dispatch.
   - **budget exhausted** → `{ status: 'failed' }`, no dispatch, when *either* holds:
     - `attempt_count >= MAX_ATTEMPTS (5)` and `render_updated_at > now() - 1 hour`
     - `mux_attempt >= MAX_ATTEMPTS (5)` and `mux_updated_at > now() - 1 hour`

     Note this must be checked **before** calling the publish service — the service's upsert would flip the
     mux row back to `pending` and the render CTE would reset the job, so a late check would both spend an
     attempt and leave the page claiming "Preparing video..." forever.
   - else → `await publishProjectToMux({ projectId, ownerId: project.owner_id, cloudVersion:
     project.cloud_version, statusCallbackUrl, log: req.log })` → `{ status: 'pending' }`.
     **Wrap in try/catch**: the service already marks the row failed before rethrowing, so the page gets
     `{ status: 'failed' }` rather than a 500. Log with `req.logCtx` (`mux.video_status`,
     `mux.auto_started: true`, and both attempt counts so a project stuck at the ceiling is greppable).

   Put the predicate in the service file as an exported pure helper —
   `canAttemptPublish({ muxAttempt, muxUpdatedAt, renderAttemptCount, renderUpdatedAt }, now)` — so it is
   unit-testable without a database and the two constants live next to the code that spends them.

   Two viewers polling at once is safe: the upsert is atomic on the `(project_id, cloud_version)` unique
   index, so exactly one gets `is_new` and dispatches.

Attribution stays the project **owner** (`project.owner_id`) — same as `mux-video-create`, so render paths
stay under the owner's storage prefix. The route keeps `optionalUser` and its 60/min per-IP limit.

Note the retry loop now closes properly: an auto-started publish immediately writes a `pending` row, so the
next 5s poll takes branch 2 and never re-dispatches; only a *failed* row re-enters branch 3, and each
re-entry costs an attempt.

### 3. `shared/api/projects.ts`

Add to `SharedVideoGetResponseSchema` ([:234-253](shared/api/projects.ts#L234-L253)):

```ts
/** Render progress 0–1 for a pending video. Absent = queued, not yet reporting. */
progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
```

No `phase` field — the three pending sub-states are derivable: absent → queued, `< 1` → rendering,
`>= 1` → Mux processing.

---

## Frontend

### 4. Theme tokens — `shared/theme/index.css`

In `@theme`, under Surfaces and Text respectively:

```css
--color-surface-media: var(--surface-media);
--color-text-on-media: var(--text-on-media);
```

In the light-theme block (beside `--surface-body` / `--text-highlighted`):

```css
/* Media surface — a stand-in for video, deliberately NOT theme-flipped:
   a player slot reads as black in both themes. No .dark override. */
--surface-media: oklch(0.14 0.02 var(--hue-primary));
--text-on-media: oklch(0.98 0 0);
```

No `.dark` counterpart — the identical value in both themes is the point, and the comment says so.

### 5. `webapp/src/pages/VideoPage.tsx`

**`PlayerPlaceholder`** ([:48-54](webapp/src/pages/VideoPage.tsx#L48-L54)) →
`aspect-video w-full bg-surface-media rounded-xl border border-border`, contents in
`text-text-on-media` / `text-text-on-media/70`.

**Loading.** Delete the full-screen `LoadingLogo` early return
([:136-142](webapp/src/pages/VideoPage.tsx#L136-L142)). Keep the `auth_required` and `error` early returns
as they are — those are whole-page states with no video chrome to show. After them, let the shell render
for both `loading` and `ready`:

```ts
const data = state.kind === 'ready' ? state.data : undefined;
```

with `data?.name ?? ''` for the title, `data?.canEdit` for the Edit button, and the placeholder holding a
spinner + **"Loading video..."** (visible text — ui-guidelines requires it and e2e asserts on its
disappearance).

**Player slot** ([:220-244](webapp/src/pages/VideoPage.tsx#L220-L244)) becomes, in order:

| State | Slot contents |
|---|---|
| no `data` | spinner + `role="status"` "Loading video..." |
| `completed` + `muxPlaybackId` | `<MuxPlayer>` (unchanged) |
| `pending`, no `progress` | spinner + "Preparing video..." + "Waiting for a render slot." |
| `pending`, `0 ≤ progress < 1` | progress bar + `{pct}%` + `role="status"` "Rendering video..." |
| `pending`, `progress ≥ 1` | spinner + "Almost ready..." + "Finishing up." |
| `failed` | `LuCircleAlert` + `role="alert"` "Something went wrong" + "We couldn't prepare this video." + contact-support link |
| otherwise | "Could not find video" |

Progress bar, following [UploadProgressToast.tsx:63-72](webapp/src/storage/UploadProgressToast.tsx#L63-L72)
(the cleanest existing instance) but on the dark ground:

```tsx
const pct = Math.round(Math.min(1, Math.max(0, data.progress ?? 0)) * 100);
<div className="h-1.5 w-48 rounded-full bg-text-on-media/20 overflow-hidden">
    <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
</div>
```

The inline `width` is the sanctioned dynamic-value exception; every other progress bar in the app does the
same.

Contact support: `SUPPORT_EMAIL` from `@shared/types/bridge` (already re-exported there), as a `mailto:`
anchor — `text-xs text-text-on-media/70 hover:underline`, matching
[AuthModal.tsx:52-57](webapp/src/auth/AuthModal.tsx#L52-L57)'s wording ("Need help? Contact support").

**Polling** ([:109](webapp/src/pages/VideoPage.tsx#L109)) is unchanged — `status !== 'pending'` still stops
it, and the auto-start answers `pending`, so the 5s poll picks up the climbing percentage on its own.

---

## Tests

**`server/test/sharedVideoGet.test.ts`** — the existing 25 cases must all still pass; the one at
[:220](server/test/sharedVideoGet.test.ts#L220) ("no mux video: project info only") changes meaning and
should be rewritten as the dispatch case. New cases:

- pending row + render job `progress = 0.42` → `progress: 0.42` in the response
- pending row + `progress IS NULL` → no `progress` key
- pending row + render job `completed` (progress 1) → `progress: 1`
- no mux row, `upload_status = 'ready'` → fake render worker received a job, a `mux_videos` row exists at
  the project's current `cloud_version` with `attempt = 1`, response `{ status: 'pending' }`
- **anonymous** caller on a public project triggers the same dispatch (the headline case)
- no mux row, `upload_status = 'pending'` → no dispatch, no `status` key
- failed row, render job `attempt_count = 3` → dispatch; job reset to pending with `attempt_count = 4` and
  the mux row's `attempt` incremented
- failed row, render job `attempt_count = 5`, `updated_at = now()` → **no** dispatch, `{ status: 'failed' }`,
  and assert the mux row is still `failed` (not flipped back to pending)
- failed row, render job `attempt_count = 5`, `updated_at = 2h ago` → dispatch
- **Mux-errored path**: render job `completed`, `attempt_count = 1`, mux row `failed` with `attempt = 5`
  and a recent `updated_at` → **no** dispatch and no `uploadToMux` call (this is the case the render
  counter alone would miss)
- `canAttemptPublish` unit tests for the four corners of the two-counter predicate (neither exhausted,
  each exhausted alone, both exhausted; inside vs. outside the hour) — no DB
- `publishProjectToMux` throws → `{ status: 'failed' }`, response is 200 not 500
- an older `completed` row with a playback id still plays and does **not** trigger a render for the
  newer `cloud_version`
- rate limit (429) case unchanged

**`server/test/muxVideoCreate.test.ts`** — unchanged behaviour after the extraction, plus `attempt`
incrementing on a failed-row retry.

**`e2e/tests/watch-page.spec.ts`** — check whether it awaits the `LoadingLogo` text; if so, retarget it at
the placeholder's "Loading video..." (same string, different node). Its gutter/panel assertions are
unaffected.

## Verification

1. `cd server && npm test` (vitest) and `npm run typecheck`; root `npx vitest run` for shared/webapp;
   `npm run lint`.
2. Local end-to-end, the real proof:
   - `npm run dev:server`, `npm run dev:render-worker`, `npm run dev:webapp`.
   - Publish a project from the share modal so it has a slug and `share_policy = 'public'`.
   - `DELETE FROM mux_videos WHERE project_id = '<id>'; DELETE FROM render_jobs WHERE project_id = '<id>';`
   - Open `/video/{slug}` **in a private window** (anonymous). Expect: dark placeholder →
     "Preparing video..." → a climbing `{pct}%` → "Almost ready..." → the player. Confirm the server log
     shows one dispatch, not one per 5s poll.
3. Failure path: with the render worker stopped, repeat the delete and load the page. The stale-job cron
   flips the job to `failed` after ~1 minute; the page should re-dispatch on the following polls and, on
   the 5th, settle on "Something went wrong" + Contact support. Verify `render_jobs.attempt_count` and
   `mux_videos.attempt` both read 5 (they increment on the retry, not on the failure), and that no further
   dispatch happens while `updated_at` is inside the hour — then backdate `render_jobs.updated_at` by 2
   hours and confirm exactly one more dispatch fires.
4. Both themes: the placeholder stays dark in light mode, and the text on it stays readable in both.
