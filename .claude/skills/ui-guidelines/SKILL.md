---
name: ui-guidelines
description: UI design system reference for this codebase. Use when building, reviewing, or modifying UI — covers design tokens, which shared components to reach for, CSS classes, and hard rules. ALWAYS load this skill before making any UI changes.
when_to_use: Always load when making any UI changes — writing or modifying React components, adding UI to a page, picking colors/shadows/text styles, reviewing UI code for design system compliance, or touching any frontend visual code.
---

# UI Guidelines

## Hard Rules

- **Never use hardcoded Tailwind palette colors** (`red-400`, `gray-700`, `blue-500`, etc.) — always use semantic tokens
- **Never use raw `<button>` elements** — always use `<Button>` from `@shared/components`
- **Check `shared/components/` before building anything custom** — most common UI needs are already covered
- **No `style={{}}` for layout/theming** — Tailwind classes only; inline styles are acceptable only for dynamically computed values (positions, widths from state, user color pickers)
- **Use shadow utilities** (`shadow-sm`, `shadow-float`) — not inline `boxShadow`; these are the only two shadow tokens

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

> These are consumed by `Button` — don't apply `interactive-*` directly on raw elements.

---

## Key Patterns

**Floating UI** — Modals, dropdowns, and tooltips use `createPortal(content, document.body)` to escape stacking contexts. Follow this pattern for any custom floating element.

**Disabled states** — `interactive-*` classes include `disabled:opacity-50 disabled:cursor-default`. For non-button elements: `opacity-50 cursor-default pointer-events-none`.

**Dark mode** — The `.dark` class on root flips all tokens automatically. No manual `dark:` overrides needed when using semantic tokens.
