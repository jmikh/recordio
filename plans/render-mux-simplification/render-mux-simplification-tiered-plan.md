# Render / Mux simplification — tiered plan

**Created:** 2026-09-06
**Status:** design approved, not started
**Owner:** John

## 1. Problem & motivation

`render_jobs` and `mux_videos` are two near-duplicate tables reconnected by an
**implicit `(project_id, cloud_version)` join** at every step. `mux_videos`
duplicates the render's `project_id`, `user_id`, `cloud_version`, `status`
(same 4-state enum), `error`, `render_storage_path`, an attempt counter, and
timestamps — it is essentially "a render job + Mux fields + the render's path
copied onto it."

The multi-resolution feature exposed this seam. Because a `mux_video` does not
know **which** render it depends on, the render→Mux link is re-derived by
`(project, version[, quality])` in **four** places, each needing a
`MUX_RENDER_QUALITY = '2K'` gate so a 1080p download render can't hijack a
shared 2K video:

1. `renderJobWebhook.ts` — Mux upload lookup (gated)
2. `renderJobWebhook.ts` — failure cascade CTE (gated)
3. `cron_render_stale_jobs.sql` — failure cascade (gated 2026-09-06)
4. `cron_mux_video_stale_jobs.sql` — render→mux join (**still ungated — live bug**, see Step 0)

This is the accidental complexity. The fix is to make the render→Mux
relationship **explicit** via a foreign key, then collapse all four sites onto
it — which deletes the quality gating and the hand-written cascade entirely.

## 2. Target design (from scratch, kept under current table names)

Strip away the tables and there is exactly **one expensive thing**: materialize
pixels for `(project, version, quality)`. Everything else consumes it. A
*download* consumer needs no row (the file is the deliverable). A *share*
consumer needs a row because Mux is a second async hop with its own IDs.

### `render_jobs` — the producer (unchanged in spirit)
- Cache key: `(project_id, cloud_version, quality)` unique among completed rows
  (already shipped 2026-09-06).
- Lifecycle: `pending → completed | failed | canceled`, `progress`, heartbeat
  via `updated_at`.
- Knows **nothing** about Mux or sharing. Pure "produce pixels" service.

### `mux_videos` — a thin consumer of a render
- **New: `render_job_id uuid REFERENCES render_jobs(id) ON DELETE SET NULL`** —
  points at the *exact* render Mux ingests. This is the whole change.
- Mux-specific fields only: `mux_asset_id`, `mux_playback_id`, `status`, `error`.
- Keeps `project_id` to back share resolution (`sharedVideoGet` picks the
  latest completed row per project by `cloud_version DESC`) and the purge job's
  per-project `MAX(cloud_version)` grouping. (Correction 2026-09-06: the
  baseline schema's `idx_mux_videos_one_active_completed` no longer exists —
  removed with the soft-delete 2026-07-22, verified against prod. Multiple
  completed rows per project legally coexist until the daily purge.)
- Everything reachable via `render_job_id` becomes droppable:
  `render_storage_path`, `user_id`, and (pending index review) `cloud_version`.

### Failure cascade = one DB trigger (decision locked)
`AFTER UPDATE ON render_jobs` when `status` transitions to `failed`/`canceled`:
fail the pending `mux_videos` where `render_job_id = NEW.id`. This removes the
cascade from `renderJobWebhook.ts` **and** both stale crons. (Chosen over
server-side cascade despite the 2026-07-25 "logic in the server" sweep: a
referential cascade keyed on an FK is data-integrity, not business logic, and
being a trigger makes it impossible to miss.)

### Reliability = two single-hop watchdogs
Each watchdog guards exactly one hop, instead of two crons with overlapping
`(project, version)` joins:
- **render heartbeat** — render `pending` with no heartbeat in 1 min → `failed`
  (the trigger then fans out to its shares). `cron_render_stale_jobs` loses its
  own cascade block and becomes a plain stale-fail.
- **Mux ingest** — a share stuck (Mux asset created, no Mux webhook back) after
  N min → `failed`. `cron_mux_video_stale_jobs` loses its "render failed but
  cascade didn't fire" belt-and-suspenders clause (the trigger guarantees it);
  only the genuine "Mux never progressed" watchdog remains.

### What collapses

| Today | Target |
|---|---|
| 4 sites re-derive render↔mux by `(project, version[, quality])` | 1 FK: `mux_videos.render_job_id` |
| `MUX_RENDER_QUALITY` **gating** in webhook + 2 crons | deleted (constant survives only as the share's render-quality **policy** in `muxVideoCreate`) |
| render→mux cascade hand-written in webhook + crons | one `AFTER UPDATE` trigger |
| mux stale cron "cascade didn't fire" + gate bug | deleted |
| `render_storage_path` copied onto `mux_videos` | join to `render_jobs` |
| "one version to Mux" enforced by convention + code | structural: a share *is* one render |

Net: `mux_videos` ~7 columns (from 13), zero `(project, version)` matching, and
the multi-quality gating disappears.

## 3. Key decisions (locked)

- **Explicit link:** `mux_videos.render_job_id` FK (not a `(project, version)` re-derivation).
- **Cascade:** single DB trigger on `render_jobs` (per supabase `sql/triggers/`, `on_<event>` naming, deployed via `deploy.sh`).
- **Names:** keep `render_jobs` / `mux_videos` — the structural win is name-independent; renaming is avoidable churn.
- **Migration:** expand → contract, so live `mux_playback_id`s are never interrupted (no shared link breaks).
- **`MUX_RENDER_QUALITY`:** kept as the share's render-quality *policy* (used once, in `muxVideoCreate`); removed as a *gate* everywhere else.

## 4. Invariants to preserve

- Render cache key: unique `(project_id, cloud_version, quality)` where completed.
- One mux_video row per `(project_id, cloud_version)`: `idx_mux_videos_project_version`. ("One active share per project" is NOT index-enforced — the old `idx_mux_videos_one_active_completed` was dropped 2026-07-22; newest-completed-wins is resolution logic in `sharedVideoGet` + the daily purge.)
- No broken share links — historical `mux_playback_id` rows survive the migration untouched.
- No direct table access from the client — all writes stay behind server routes / the trigger (per CLAUDE.md).
- Render worker contract is untouched (renders + calls `renderJobWebhook`).

## 5. Migration strategy (expand → contract)

Classic expand/contract so every step is independently deployable:
- **Expand** (Step 1): add the column, write it on all new rows, backfill history. Readers unchanged.
- **Switch** (Step 2): move cascade + upload + crons onto the FK; add the trigger; delete gating.
- **Contract** (Step 3): drop the now-dead columns.
- **Cleanups** (Step 4): optional consolidation, folded in per appetite.

Deploy order per step: additive migration → server → cron/trigger deploy for
Step 1–2; server (stops writing dropped cols) → migration for Step 3.

## 6. Steps

Detailed step docs are written when each step starts (not upfront).

- **Step 0 (optional immediate hotfix)** — gate `cron_mux_video_stale_jobs.sql`'s render→mux join with `rj.quality = '2K'` (mirrors the other three sites). Live bug today; made moot by Step 2, so skip if Step 2 lands soon.
- **Step 1 — Expand.** Add `mux_videos.render_job_id` FK + index (migration). `muxVideoCreate` writes it from the render resolution. Backfill historical rows (match on `render_storage_path`, then the 2K render, then any completed render for the `(project, version)`). No reader/behavior change.
- **Step 2 — Switch to the FK.** Add the `AFTER UPDATE ON render_jobs` cascade trigger. `renderJobWebhook`: drop the cascade CTE, switch the Mux-upload lookup to `render_job_id`, remove the `quality` gate + select. `cron_render_stale_jobs`: drop its cascade block (trigger owns it). `cron_mux_video_stale_jobs`: repoint the join to `render_job_id`, keep only the "Mux never progressed" clause. Update tests.
- **Step 3 — Contract.** Drop `mux_videos.render_storage_path` (repoint `uploadToMux`/purge to read the render's path via FK; renders already own their file deletion). Evaluate dropping `user_id` / `cloud_version` against the remaining indexes. Migration + server updates.
- **Step 4 — Cleanups (optional, scope tail).** Shared purge helper for the two near-identical purge jobs; unify `attempt` / `attempt_count`; reconcile soft-delete (`is_deleted`) vs hard-purge; (larger, separate) add minute-granularity to the server scheduler and port both fail-stale crons out of pg_cron.

## 7. Step log

_(none yet — update after each step: completion date + any design changes, propagated back into §2–6)_

## 8. Risks & open questions

- **Backfill ambiguity.** Pre-multi-quality `mux_videos` point at a 1080p render; recent ones at 2K. Matching on `render_storage_path` (the exact ingested file) is precise; the quality/any-completed fallbacks are best-effort. Rows with no match get `render_job_id = NULL` (acceptable — superseded/dead shares).
- **`ON DELETE SET NULL` vs purge.** Superseded renders are hard-purged; a superseded share's FK goes NULL, which is fine. The *active* share's render is never purged (purge keeps the latest version), so the active link is stable.
- **Trigger vs the inlining sweep.** Reintroduces one DB trigger against the 2026-07-25 direction. Justified as referential integrity, but note the divergence in the trigger's header comment.
- **`cloud_version` on `mux_videos`.** `idx_mux_videos_project_version` (unique `(project, version)`) and some purge/stale logic use it. Dropping it in Step 3 may require replacing that constraint; decide in the Step 3 doc rather than committing now.
- **Deploy coordination.** Step 2 spans server + trigger + two crons; deploy the trigger with (or just before) the server so the webhook can safely stop cascading.
