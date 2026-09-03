---
name: ui-guidelines
description: UI design system reference for this codebase — covers design tokens, shared components, CSS classes, and hard rules. Always load before making any UI changes (React components, colors/shadows/text styles, or frontend visual code).
---

# UI Guidelines

## Hard Rules

- **Never use hardcoded Tailwind palette colors** (`red-400`, `gray-700`, `blue-500`, etc.) — always use semantic tokens
- **Never use raw `<button>` elements** — always use `<Button>` from `@shared/components`
- **Check `shared/components/` before building anything custom** — most common UI needs are already covered
- **No `style={{}}` for layout/theming** — Tailwind classes only; inline styles are acceptable only for dynamically computed values (positions, widths from state, user color pickers)
- **Use shadow utilities** (`shadow-sm`, `shadow-float`) — not inline `boxShadow`; these are the only two shadow tokens
- **Never use arbitrary font sizes** (`text-[10px]` etc.) — the scale is `text-2xs/xs/sm/base` plus `heading-1/2`; see Typography. If you come across an existing arbitrary size (`text-[13px]` and the like) in code you're touching, flag it and suggest replacing it with the nearest scale token
- **Never use `font-medium`, `font-semibold`, `font-normal`, or any weight other than `font-bold`** — default weight is 500 globally; `font-bold` (700) is the only other weight
- **Every interactive/status element must be addressable by accessible semantics** — see Labels & Testability below

---

## Labels & Testability

E2e tests (`e2e/`) select elements by accessible semantics — role, label, visible text — never CSS classes. Anything a user can click, type into, or perceive as status must be addressable that way. Rollout plan + inventory: `plans/testable-ui-labels.md`.

- **Icon-only buttons** (no visible text): always `aria-label` (`<Button variant="icon" icon={FaUndo} aria-label="Undo" />` — `Button` passes `aria-*` through). `title` alone is a weak fallback.
- **Inputs**: a real `<label>`, or `aria-label`, or a stable semantic id (the `#project-name-input` pattern). Placeholder text is NOT a label — it changes with copy.
- **Toasts / async status**: `role="status"` for info/success, `role="alert"` for errors — lets tests (and screen readers) await "any error appeared" generically.
- **Modals**: `role="dialog"` + `aria-label` naming the dialog.
- **Loading states**: visible text in the DOM (e.g. "Loading project..."), not just a spinner — tests assert completion by its disappearance.
- **Toggles/checkboxes/sliders**: wire the accessible name to the visible label (Toggle already does `role="switch"`).
- **`data-testid`**: last resort, only where no semantic handle exists (e.g. canvas overlays).
- Label wording = what the user perceives ("Close", "Record", "Search projects"), sentence case, stable — treat renames as breaking changes for tests.

---

## Shared Components

All in `shared/components/` (barrel-exported from `@shared/components`). Read the component file before using it.

| Component | When to use |
|---|---|
| `Button` | Any clickable button. Variants: `base`, `primary`, `ghost`, `icon`, `destructive` |
| `Modal` | Portal-rendered overlay dialog |
| `XButton` | Small circular remove/close button |
| `Toggle` | Boolean on/off switch, with optional label |
| `MultiToggle` | Pill-style multi-option selector |
| `Dropdown` | Select input with portal-rendered menu |
| `CollapsibleCard` | Animated expand/collapse section |
| `LogoLink` | Branding/logo link |
| `Tooltip` / `InfoTooltip` | Portal-rendered tooltips |
| `Checkbox` | Styled checkbox with label |
| `Slider` | Input range controls |
| `ProBadge` | Pro/Free tier badge |
| `SidebarNav` / `SidebarNavItem` | Sidebar navigation lists (dashboard sidebar, editor settings nav): full-bleed left, right margin, sliding accent bar; hover previews the selected look |

---

## Design Tokens

Defined in `shared/theme/index.css`. Light and dark themes are fully covered — never use `dark:` variants for colors when a semantic token exists.

### Surfaces
- `bg-surface-body` — page background
- `bg-surface` — cards, panels
- `bg-surface-raised` — modals, dropdowns, elevated UI

### Text
- `text-text-highlighted` — headings, emphasized labels
- `text-text-main` — default body text
- `text-text-muted` — secondary/helper text
- `text-text-disabled` — disabled state
- `text-text-on-primary` / `text-text-on-secondary` — text on brand backgrounds

### Borders
- `border-border` — default
- `border-border-hover` — hovered
- `border-border-selected` — selected/active

### Interactive State Overlays (backgrounds)
- `bg-state-inactive` — subtle fill for unselected items
- `bg-state-hover` — hover background
- `bg-state-active` — pressed background

### Brand Colors
- `primary` (purple, hue 290) — CTAs, active indicators
- `secondary` (yellow, hue 58) — highlights, selection glow
- `tertiary` (teal, hue 155) — accent

### Semantic States
- Error/danger: `text-destructive`, `bg-destructive/10`, `border-destructive/30`
- Success: `text-success`, `bg-success/10`, `border-success/30`

### Shadows
- `shadow-sm` — subtle depth (inputs, cards, buttons)
- `shadow-float` — floating UI (modals, dropdowns, tooltips)

### Radius
- `rounded-[var(--radius-sm)]` (4px) — tags, badges
- `rounded-[var(--radius-md)]` (8px) — cards, inputs, buttons
- `rounded-[var(--radius-lg)]` (12px) — modals, large panels
- `rounded-[var(--radius-interactive)]` (8px) — all interactive controls

---

## Typography

Global font: Satoshi (Fontshare, weights 400/500/700 only — 400 exists solely for the canvas timeline ruler). Default weight is **500**, applied globally on `html/body/#root` — write nothing for normal text.

### Size scale

`text-xs` is redefined to 13px and `text-2xs` (11px) is added in `@theme` (`shared/theme/index.css`); the rest are Tailwind stock.

| Class | Size / line-height | Usage |
|---|---|---|
| `text-2xs` | 11px / 16px | Dense editor chrome only: timecodes, timeline labels; also inside `text-badge`/`text-eyebrow` |
| `text-xs` | 13px / 18px | Helper/secondary text, metadata, tooltips |
| `text-sm` | 14px / 20px | Default for almost all normal-sized text: buttons, inputs, menu items, list rows, tabs, card titles |
| `text-base` | 16px / 24px | Bigger emphasis text on very uncrowded pages: hero/main copy with lots of breathing room |
| `text-lg` / `text-2xl` | 18px / 24px | Only via `heading-2` / `heading-1` — don't use raw |

Rule of thumb: almost everything → `sm` · main text on a sparse, uncrowded page → `base` · titles → `heading-2`/`heading-1` · helper/metadata → `xs` · dense editor chrome → `2xs`.

### Weights

Exactly two: **500 (default, write nothing)** and **`font-bold` (700)** for headings/emphasis. Never `font-medium` (no-op), `font-semibold`, `font-normal`, or any other weight class. Don't nest lighter-weight text inside a bold/eyebrow element — there is no weight-reset utility; restructure into sibling elements instead.

### Role classes

Use these instead of hand-rolling the combos:

| Class | Definition | Usage |
|---|---|---|
| `heading-1` | `text-2xl font-bold text-text-highlighted` | Hero modal/page titles (auth, upgrade) |
| `heading-2` | `text-lg font-bold text-text-highlighted` | All page titles, modal titles, section headings |
| `text-eyebrow` | `text-2xs font-bold uppercase tracking-widest text-text-muted` | Tiny uppercase group label above a section (sidebar groups, settings list headers). Never hand-roll `uppercase tracking-widest` |
| `text-badge` | `text-2xs font-bold leading-none` | Pill/chip/counter typography; bg, padding, and radius stay local |
| `subtext` | `text-xs text-text-muted text-left` | Helper text in settings panels |

Color overrides compose: `text-eyebrow text-primary` works (utilities beat `@layer components`).

---

## Icon Sizing

All icons use standardized CSS classes instead of inline `size` props. Defined in `@layer components` in `shared/theme/index.css`.

| Class | Size | Usage |
|---|---|---|
| `icon-sm` | 14px | Small inline icons, chevrons, secondary actions |
| `icon-md` | 16px | Default icon size, settings icons, timeline block icons |
| `icon-lg` | 20px | Prominent icons, nav icons, modal headers |

### Rules
- **Never use inline `size={N}` on react-icons** — always use `className="icon-sm"` / `icon-md` / `icon-lg`
- **Button `icon` prop**: Pass a component type (not element) to auto-size: `<Button variant="icon" icon={FaUndo} />`. Icon-variant buttons get `icon-md`; other variants get `icon-sm`.
- **Hero/decorative icons** (32px+) are the only exception — use inline `size` for one-off large display icons
- Icons from `react-icons` accept `className`; CSS `width`/`height` override SVG attribute dimensions

---

## CSS Component Classes

Defined in `@layer components` in `shared/theme/index.css`.

| Class | Description |
|---|---|
| `interactive-base` | Default button style |
| `interactive-primary` | Primary CTA (purple bg) |
| `interactive-ghost` | Borderless, subtle |
| `interactive-icon` | Circular icon button, scale on hover |
| `interactive-destructive` | Destructive action (red bg) |
| `interactive-selected` | Secondary border + glow for selected state |
| `chosen-dot` | Small primary-colored glowing dot |
| `focus-ring` | `focus-visible` ring using primary color |
| `scrollbar-hide` | Hides scrollbar cross-browser |
| `scrollbar-thin` | Thin styled scrollbar |
| `subtext` | `text-xs text-text-muted text-left` |
| `heading-1` | Hero modal/page title (see Typography) |
| `heading-2` | Page/modal/section title (see Typography) |
| `text-eyebrow` | Uppercase group label (see Typography) |
| `text-badge` | Pill/chip text (see Typography) |

> These are consumed by `Button` — don't apply `interactive-*` directly on raw elements.

---

## Key Patterns

**Floating UI** — Modals, dropdowns, and tooltips use `createPortal(content, document.body)` to escape stacking contexts. Follow this pattern for any custom floating element.

**Disabled states** — `interactive-*` classes include `disabled:opacity-50 disabled:cursor-default`. For non-button elements: `opacity-50 cursor-default pointer-events-none`.

**Dark mode** — The `.dark` class on root flips all tokens automatically. No manual `dark:` overrides needed when using semantic tokens.
