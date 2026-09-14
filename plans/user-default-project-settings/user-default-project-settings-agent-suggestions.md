# User Default Project Settings — agent suggestions

Things noticed while implementing the plan that are out of its scope. Not applied.

1. **`.claude/CLAUDE.md` § Data Access is stale.** It says all DB access goes through
   "RPC (DB functions) or edge functions"; both are decommissioned (`supabase/functions/`
   is empty, `supabase/sql/graveyard.sql` drops every client RPC). The live rule is
   webapp `invokeFunction()` → Fastify route (`server/src/routes/**`) → SQL, with the
   contract in `shared/api/`. Suggested wording: "No direct table access from the client.
   Every database operation is a Fastify route under `server/src/routes/` with its
   request/response types in `shared/api/` (add the `ApiRoutes` entry), called through
   `invokeFunction`." — needs the user's go-ahead (CLAUDE.md/skills rule).

2. **`project-model` skill §1 / §2 mention edge functions** ("metadata via edge functions",
   "`cloudStorage.ts` — server calls (edge functions: …)"). Same fix as above, plus a line
   that `importRecordingLocalV2` now injects the user's resolved personal defaults into
   `createFromSource` (fallback: `createDefaultSettings()` when
   `user_profiles.project_defaults` is NULL). Needs permission before editing.

3. **CDN origin mismatch in docs.** `shared/urls.ts` has `CDN_ORIGIN = https://cdn.recordio.io`
   while `cdn/CLAUDE.md` and `.claude/skills/cdn/SKILL.md` say `cdn.recordio.cc`. Whichever is
   current, the other should be updated (affects where `cdn/samples/*` must be uploaded).

4. **`webapp/src/storage/cloudStorage.ts` class doc** still says "All operations go through
   the Supabase client with RLS" — they go through `invokeFunction`.

5. **`shared/components/Dropdown.tsx` accessibility.** The trigger declares
   `aria-haspopup="listbox"` but the menu entries are plain `<button>`s (no
   `role="listbox"` / `role="option"`, no `aria-selected`). Tests must target them as
   buttons (see `e2e/tests/personal-settings.spec.ts`). Suggest a `role="listbox"`
   container with `role="option"` items, keeping the current keyboard handling.

6. **Raw `<button>` in `EffectsSettings.tsx`** ("Preview sound", ~line 112) violates the UI
   guideline "never use raw `<button>` elements"; the Step 5 Preview buttons use the shared
   `Button`. Suggest converting the sound one too (`<Button variant="ghost"
   icon={TbPlayerPlay} aria-label="Preview sound" />`).

7. **`SettingsPanel.tsx` `useMemo` dependency** `hasMicrophone` is unused in the memo
   (pre-existing lint warning); trivial cleanup when that file is next touched.

8. **`useProjectStore.loadProject()` backfills duplicate `createDefaultSettings()`
   literals** (`screen`, `background`, `zoom`, …; the `background` backfill even hardcodes
   `https://cdn.recordio.io/backgrounds/bg8.avif` instead of `CDN_ORIGIN`). Now that
   `mergeSettingsOntoDefaults` exists (`webapp/src/core/projectDefaults.ts`), those
   backfills could become one `mergeSettingsOntoDefaults(createDefaultSettings(),
   project.settings)` — same result, one source of truth. Larger blast radius (every project
   load), so left for a dedicated change with the existing migration tests extended.
