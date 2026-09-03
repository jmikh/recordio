# Typography Standardization (oneshot)


## Context

Typography is currently half-centralized: Satoshi + global weight 500 live in `shared/theme/index.css`, but there is no size scale — components hand-pick from Tailwind defaults plus ~45 arbitrary `text-[8–13px]` values scattered across ~50 files. Weight classes are misleading: `font-medium` is a no-op (default is already 500) and `font-semibold` renders as 700 because weight 600 was never loaded from Fontshare. The user finds most text too small and thin, especially the dashboard. The root `tailwind.config.js` is dead (Tailwind v4 reads CSS `@theme`; no `@config` directive exists) — its never-applied `fontSize.xs` bump shows someone already tried to fix this in the wrong place.

**Decisions made with user:** small scale + a few role classes (not full semantic classes); bump `text-xs` globally 12→13px + targeted promotions (dashboard especially); exactly two weights (500 default + 700 `font-bold`); oneshot plan. Not chosen: muted-opacity change, mass muted→main sweep, loading a real 600.

**Scope boundary:** `shared/painters/` (captionPainter, overlayPainter — canvas user-content rendering) and canvas `ctx.font` strings (TimelineRuler) are untouched. e2e tests select by accessible roles only — zero class coupling.

## The new standard

**Scale** (everyone picks from these; `text-2xs` exists so dense editor chrome/badges need no arbitrary values — 13px doesn't fit timeline blocks). Each token sets font size AND default line-height (the vertical space per line):

| Token | Size / line-height | Role |
|---|---|---|
| `text-2xs` (new) | 11px / 16px | Dense editor chrome: timecodes, timeline labels, badges only |
| `text-xs` (redefined) | 13px / 18px (was 12/16) | Helper/secondary text, metadata, tooltips, `.subtext` |
| `text-sm` (stock) | 14px / 20px | Default: controls and chrome — buttons, inputs, menu items, list rows |
| `text-base` (stock) | 16px / 24px | One-step promotion for primary content the user scans: card titles, dashboard nav/tabs |
| `text-lg` / `text-2xl` | 18px / 24px | Only via `heading-2` / `heading-1` |

Rule of thumb: controls/chrome → `sm` · the content you're looking for → `base` · titles → `heading-2`/`heading-1` · helper/metadata → `xs` · dense editor chrome only → `2xs`.

**Weights:** default 500 (global, write nothing) + `font-bold` (700). All `font-medium` / `font-semibold` / `font-normal` are removed repo-wide. Rendered-pixel changes from the weight sweep are nearly nil: `font-medium` was a no-op and semibold already rendered as 700; the only real changes are the six `font-normal` removals (incl. the too-thin project card title) and two badges gaining bold.

**Role classes** (only for verbatim-repeated patterns): `text-eyebrow` (the small uppercase label above a section — e.g. LIBRARY/MANAGE in the sidebar, ACTIVE MEMBERS in settings; currently hand-rolled ~15×), `text-badge` (pill/chip text), `heading-1` (hero modal titles), `heading-2` (page/section/modal titles), plus existing `subtext` (unchanged; inherits the 13px bump).

## Step 1 — Theme (`shared/theme/index.css`) + dead config

1. Trim Fontshare import (line 1) to `satoshi@400,500,700`. 300/900 are used nowhere (no font-light/black classes, no painter usage). **Keep 400**: TimelineRuler.tsx draws at weight 400 and awaits `document.fonts.load('10px Satoshi')`. Caption 600→700 substitution is unchanged by this trim.
2. Add size tokens inside the existing `@theme` block (after `--font-sans`):
   ```css
   /* Type scale — see .claude/skills/ui-guidelines/SKILL.md → Typography */
   --text-2xs: 0.6875rem;              /* 11px — dense editor chrome, badges */
   --text-2xs--line-height: 1rem;
   --text-xs: 0.8125rem;               /* 13px — bumped from stock 12px */
   --text-xs--line-height: 1.125rem;
   ```
3. Add role classes in `@layer components` next to `.subtext` (~line 339):
   ```css
   .text-eyebrow { @apply text-2xs font-bold uppercase tracking-widest text-text-muted; }
   .text-badge   { @apply text-2xs font-bold leading-none; }  /* typography only; bg/padding/radius stay local */
   .heading-1    { @apply text-2xl font-bold text-text-highlighted; }  /* hero modal/page titles */
   .heading-2    { @apply text-lg font-bold text-text-highlighted; }   /* page/section/modal titles */
   ```
   Utilities are emitted after `@layer components`, so per-site overrides like `text-eyebrow text-primary` work.
4. Clean no-op weights from `interactive-*`: delete `font-medium` from `.interactive-primary` (:227) and `.interactive-destructive`; `.interactive-ghost` transition drops `font-weight 0.15s` (:233), `:hover` drops `font-medium` (:237), `:disabled:hover` drops `font-weight: normal` (:243).
5. Delete `tailwind.config.js` (repo root). Verified unreferenced: no `@config` in any CSS, `postcss.config.js` uses `@tailwindcss/postcss` auto-discovery, zero hits across configs/scripts/Dockerfiles.

## Step 2 — Mapping rules (applied in Steps 3–6)

| Old | New |
|---|---|
| `font-medium` (~50) | delete |
| `font-semibold` (~55) | `font-bold` |
| `font-normal` (6) | delete; MembersSection eyebrows need restructure (below) |
| `text-[10/11px] … uppercase tracking-*` eyebrows | `text-eyebrow` |
| `text-[10px]` badge-shaped (`px-1.5 py-0.5 rounded`) | `text-badge` (+ keep local bg/padding) |
| Other `text-[8/9/10px]` (editor chrome, timecodes) | `text-2xs` |
| `text-[11px]` non-eyebrow, `text-[13px]` | `text-xs` |
| `text-base font-semibold text-text-highlighted` (settings headings) | `heading-2` (base→lg promotion) |
| `text-lg/xl font-semibold/bold [text-text-highlighted]` titles | `heading-2` (kills `text-xl` from webapp) |
| `text-2xl font-bold` hero titles | `heading-1` (stat numbers like MembersSection.tsx:51 keep raw `text-2xl font-bold`) |
| Dashboard promotions | ProjectCard title `text-sm font-normal`→`text-base` (:225,:228); DashboardSidebar nav `text-sm`→`text-base` (:141); DashboardHeader tabs `text-sm`→`text-base` (:72), count pill→`text-badge` |

**MembersSection eyebrow restructure** (:45–48, :438, :462): the eyebrow `<p>` embeds a sublabel span reset via `font-normal normal-case tracking-normal` — illegal in a two-weight system. Split into siblings:
```tsx
<p className="flex items-baseline gap-1.5 mb-3">
    <span className="text-eyebrow">{label}</span>
    <span className="text-xs text-text-muted">· {sublabel}</span>
</p>
```

## Steps 3–6 — Sweep by area (build stays green after each)

**Step 3 – Shared components:** `ProBadge.tsx:20`→`text-badge` (drop `leading-none`, now in class); `CollapsibleCard.tsx:122` drop `font-medium`; `ProgressModal.tsx:32`→`heading-2`. Button/Tooltip/Checkbox/Slider/Toggle/Dropdown need no edits — their `text-xs` auto-bumps.

**Step 4 – Dashboard + global components:** `ProjectCard.tsx` (title promotion + `font-normal` removal, duration badge :205→`text-badge`, Draft :238→`text-2xs`), `DashboardSidebar.tsx` (eyebrows :130,:163; nav promotion; upgrade links :212,:216→`text-xs`), `DashboardHeader.tsx`, `DashboardPage.tsx` (`heading-2` ×3), `WorkspaceDropdown.tsx` (:53→`text-eyebrow` — gains uppercase, intentional), `Toast.tsx` (`text-[13px]`→`text-xs`), `UserMenu.tsx`, `SupportModal.tsx`, `LeaveReviewModal.tsx` (:98→`heading-2`), `UploadProgressToast.tsx`, `ProGate.tsx`.

**Step 5 – Settings/auth/billing/pages:** `MembersSection.tsx` (restructure ×3, `heading-2` ×2, badges :179,:184→`text-badge`, weight sweep), `BillingSection.tsx` (:203→`heading-2`, :290→`text-2xs`, :381→`text-badge`), `GeneralSection.tsx`, `WorkspaceSettingsPage.tsx`, `AuthModal.tsx` (:62→`text-eyebrow text-primary`, :65→`heading-1`, :94→`text-eyebrow`, :116→`subtext`, :120→`text-xs`), `ProUpgradeModal.tsx` (eyebrows + `heading-1`), `TrialExtendLink.tsx`, `CapRecoveryPanel.tsx` (:148,:196→`text-eyebrow`), `ImportPage.tsx`, `AcceptInvitePage.tsx` (×3→`heading-2`), `UninstallPage.tsx` (:16→`heading-1`), `VideoPage.tsx` (:96→`heading-2`).

**Step 6 – Editor:** `ColorSettings.tsx` (`text-[10px] font-bold/semibold` ×5→`text-2xs font-bold`; :170,:233→`text-2xs`), `header/Header.tsx` (:232→`text-2xs`), `TimelineSettings.tsx:189`, `TimelineBlockStyles.ts:158`, `RecordingSegment.tsx:220`→`text-badge`, `OverlayBlock.tsx:100` (`text-[8px]`→`text-badge`; fits — label gated behind ≥44px width with `overflow-hidden`; if cramped, raise gate at :99 from `+16` to `+24`), `ScreenSettings.tsx:184`, `EasingTooltipContent.tsx`, `LinkToggle.tsx:52`, `SettingsPanel.tsx` (drop `font-medium` ×3), `DownloadModal.tsx` (`heading-2` ×3), `FaceAnchorModal.tsx` (:147→`heading-2` — color changes main→highlighted, intentional), `SyncFailedModal.tsx`, `ConflictModal.tsx`, editor `App.tsx:251`, `DebugBar.tsx` (`text-[10px]` ×7→`text-2xs`).

**Step 7 – Extension (`extension/src/`):** pure weight sweep (`font-medium` delete, `font-semibold`→`font-bold`) in `PopupApp.tsx`, `PreRecordingView.tsx`, `RecordingView.tsx`, `WelcomeApp.tsx`, `RecordingPhase.tsx`, `ControllerApp.tsx`. Timer/hero sizes (`text-2xl/3xl`) stay — deliberately large.

## Step 8 — Update `.claude/skills/ui-guidelines/SKILL.md` (user approved via this plan)

- Hard Rules: add "never arbitrary `text-[Npx]`" and "never `font-medium`/`font-semibold`/`font-normal` — 500 is the global default, `font-bold` is the only other weight".
- New `## Typography` section before Icon Sizing: the scale table above (noting `text-xs` is redefined to 13px in `@theme`), the two-weight rule (Satoshi loads 400/500/700; 400 exists only for the canvas timeline ruler), role classes with usage rules, and "don't nest lighter text inside a bold/eyebrow element — restructure into siblings".
- Add `text-eyebrow`/`text-badge`/`heading-1`/`heading-2` rows to the CSS Component Classes table.

## Verification

Automated:
```
npm run lint && npm run build:webapp && npm run build:extension:dev && npm run test:ci && npm run test:e2e
```
Grep assertions (each must be empty; `shared/painters/` excluded by construction):
```
grep -rnE "font-(medium|semibold|normal|light|thin|black|extrabold)" webapp/src extension/src shared/components shared/theme
grep -rnE "text-\[[0-9]+px\]" webapp/src extension/src shared --include="*.tsx" --include="*.ts"
grep -rn "text-xl\b" webapp/src --include="*.tsx"
grep -rnE "tracking-(widest|wider)" webapp/src --include="*.tsx"   # all folded into .text-eyebrow
```
Sanity counts: `text-eyebrow` ≈10, `text-badge` ≈8, `heading-2` ≈20.

Manual (`npm run dev:webapp` → localhost:3001; extension via `npm run build:extension:dev` + load `extension/dist`):
- Dashboard: 16px card titles/nav/tabs, eyebrows, duration/Draft chips, count pills.
- Settings: `heading-2` titles, restructured Members eyebrows, You/Plan Owner badges, billing -N% pill.
- Editor: timeline at min/max zoom (OverlayBlock "+N", ghost labels, drag bubble, timecodes), ColorSettings, history counter; both themes.
- Auth/Upgrade modals: eyebrow + `heading-1` stack. Extension: 320px popup height, controller timer, welcome page.

## Risks

1. `text-xs` line-height 16→18px grows tight rows (checkbox labels, card metadata, menu emails) — all flex/auto-height; fallback is `--text-xs--line-height: 1rem` if rhythm looks off.
2. Button `size="sm"` (13px) nearly matches default (14px) — accepted; fix in Button later if needed.
3. Visible-by-design changes to call out in PR: project card title heavier+larger, WorkspaceDropdown label becomes uppercase, duration badge/drag bubble gain bold, FaceAnchorModal title color, AuthModal eyebrow shrinks 12→11px.
4. Extension popup fixed 320px — only wrapping helper `<p>`s grow; verify no scroll.
5. Cloud render page loads no fonts at all (pre-existing gap, out of scope) — note as TODO; optional follow-up: make `captionPainter.ts:80` say `700` instead of relying on 600→700 substitution.
