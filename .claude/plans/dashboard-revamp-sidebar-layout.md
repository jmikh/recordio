# Dashboard Revamp: Sidebar + Content Layout

## Context
The dashboard is currently a single-column layout (header → toolbar → grid). The goal is to revamp it into a two-panel layout with a persistent left sidebar containing navigation (Library, Folders) and a main content area with search, filter tabs, and time-grouped recording cards. Non-functional items (Starred, Trash, Folders) get rendered as UI with "coming soon" behavior and TODOs for future wiring.

## Files to Modify
- `webapp/src/pages/DashboardPage.tsx` — restructure into sidebar + main layout
- `webapp/src/components/ProjectCard.tsx` — add expiry badge, share link button, layout tweaks
- `webapp/src/storage/cloudProjectService.ts` — add `shareSlug` to `ProjectListItem`
- `webapp/src/storage/cloudStorage.ts` — add `share_slug` to `CloudProjectSummary`
- `supabase/sql/functions/project_list.sql` — include `slug` in query output (then run `build-functions.sh`)

## Files to Create
- `webapp/src/components/DashboardSidebar.tsx` — new sidebar component
- `webapp/src/components/DashboardHeader.tsx` — search + filter tabs + sort
- `webapp/src/utils/groupByTime.ts` — time-grouping utility
- `shared/components/CopyLinkButton.tsx` — reusable copy-link-to-clipboard button (add to barrel export)

## Implementation Steps

### 1. Add `slug` to `project_list` RPC and types
**Files:** `supabase/sql/functions/project_list.sql`, `webapp/src/storage/cloudStorage.ts`, `webapp/src/storage/cloudProjectService.ts`

The `project_list` SQL function already checks `p.slug IS NOT NULL` for `is_shared`. Add `'slug', p.slug` to the `jsonb_build_object` output.

Update `CloudProjectSummary` to include `slug: string | null`.

Update `ProjectListItem` to include `shareSlug: string | null`, mapped from `s.slug`.

This gives each card access to the share URL without an extra RPC call.

### 2. Create `CopyLinkButton` shared component
**File:** `shared/components/CopyLinkButton.tsx` (add export to `shared/components/index.ts`)

Reusable button that copies a URL to clipboard and shows a brief "copied" state.

Props:
```ts
interface CopyLinkButtonProps {
    url: string;
    className?: string;
}
```

Renders as an icon button (`interactive-icon` variant style) with `LuLink` icon. On click: `navigator.clipboard.writeText(url)`, swap icon to `LuCheck` for 2 seconds, then back. Prevents event propagation so it doesn't trigger the card's `onClick`.

### 3. Create `groupByTime` utility
**File:** `webapp/src/utils/groupByTime.ts`

Pure function: takes sorted `ProjectListItem[]`, returns `{ label: string, items: ProjectListItem[] }[]`.

Groups: "Today", "Yesterday", "Earlier this week", "Last week", "Last month", "Older". Only return non-empty groups. Only apply time grouping when sort is by date (newest/oldest) — for name sort, return a single flat group.

### 4. Create `DashboardSidebar`
**File:** `webapp/src/components/DashboardSidebar.tsx`

Layout (top to bottom):
- `<LogoLink />` + `<ProBadge />` 
- **"New recording" button** — full-width primary button, calls existing `handleRecord` logic
- **LIBRARY section** — section label + nav items:
  - All Recordings (active state, count badge) — functional
  - Starred (count: 0) — coming-soon toast on click + TODO comment
  - Shared (count from `isShared` items) — coming-soon toast + TODO
  - Trash — coming-soon toast + TODO
- **FOLDERS section** — section label + placeholder folder items with coming-soon toast + TODO
- **Bottom area** (`mt-auto`) — ThemeToggle, bug report button, UserMenu (or Sign In)

Styling: `w-60 shrink-0 border-r border-border bg-surface sticky top-0 h-screen flex flex-col overflow-y-auto p-4`

Active nav item: `bg-primary/10 text-primary font-medium` with left border accent. Inactive: `text-text-main hover:bg-state-hover`.

Icons from `react-icons/lu`: `LuLayoutGrid`, `LuStar`, `LuShare2`, `LuTrash2`, `LuFolder`.

### 5. Create `DashboardHeader`
**File:** `webapp/src/components/DashboardHeader.tsx`

Two rows:
1. **Top row:** Search input (right-aligned, `LuSearch` icon, filters by project name client-side). Optional "Import" button placeholder.
2. **Filter tabs row:** "All" (with count, functional), "Screen + camera" (placeholder), "Screen only" (placeholder), "Under 1 min" (functional — `durationMs < 60000`). Sort dropdown on the right (reuse existing `Dropdown` + `SORT_OPTIONS`).

Placeholder tabs show coming-soon toast on click.

### 6. Refactor `DashboardPage`
**File:** `webapp/src/pages/DashboardPage.tsx`

New structure:
```
<div flex>
  <DashboardSidebar ... />
  <div flex-1>
    <DashboardHeader ... />
    <main> (time-grouped grid) </main>
  </div>
  {/* floating bar + modals unchanged */}
</div>
```

New state: `searchQuery`, `activeFilter`

Data pipeline: projects → search filter → tab filter → sort → time group → render sections.

Each time group renders as a section with label + count + grid of `ProjectCard`s.

All existing functionality preserved: modals, select mode, bulk delete, auth flow, URL param handling.

### 7. Update `ProjectCard`
**File:** `webapp/src/components/ProjectCard.tsx`

New props added to `ProjectCardData`:
```ts
expiresAt?: string | null;
shareSlug?: string | null;
```

**Expiry badge:** If `expiresAt` is set and in the future, show "Deletes in X days" badge on the card (small text below time ago, styled with `text-destructive` muted). Calculate days remaining from `expiresAt - now`.

**Share link button:** If `shareSlug` is set, show `<CopyLinkButton url={VIDEO_BASE_URL/slug} />` in the card info area (next to the title or as an action on hover). Construct URL using the same `VIDEO_BASE_URL` pattern from SettingsPanel. Stops propagation so clicking it doesn't open the project.

**Other changes:**
- Add deterministic colored left border accent (derived from project ID)
- Adjust info layout: title on one line, `timeAgo` + expiry on second line below
- Keep sidebar variant unchanged for editor usage

## Design Decisions
- **Sort + time grouping:** Only show time-group headers for date-based sorts. Name sort shows flat grid.
- **Responsive:** Sidebar hidden below `md` breakpoint with `hidden md:flex`. Can add hamburger toggle as follow-up.
- **Select mode:** Select-all operates on the filtered set (after search + tab filter).
- **Empty states:** Distinct messages for "no projects" vs "no search results".
- **Colored accents on cards:** Deterministic from project ID so colors are stable but varied.
- **CopyLinkButton in shared/components:** Reusable across the app (dashboard cards, editor, etc.). Uses the existing `interactive-icon` pattern.
- **Expiry display:** "Deletes in X days" for normal view. In trash view (future), would show "Permanently deleted in 30 days" instead.

## Verification
1. Run dev server, load dashboard
2. Verify sidebar renders with all sections, "New recording" works
3. Verify search filters cards in real-time
4. Verify "Under 1 min" filter works, placeholder filters show toast
5. Verify time grouping shows correct labels
6. Verify sort dropdown works, name sort removes time group headers
7. Verify select mode + bulk delete still works
8. Verify all modals (auth, upgrade, support) still open correctly
9. Verify starred/trash/folder clicks show "coming soon" toast
10. Verify cards with `expiresAt` show "Deletes in X days"
11. Verify cards with `shareSlug` show copy-link button, clicking copies URL and shows check icon
12. Check responsive behavior at various breakpoints
13. Run `supabase/sql/build-functions.sh` after SQL change
