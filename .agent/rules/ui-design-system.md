---
trigger: always_on
---

## Design System Compliance

- **Never use hardcoded Tailwind palette colors** (e.g., `red-400`, `green-500`, `gray-700`, `blue-900`). Always use semantic tokens:
  - Error/danger → `text-destructive`, `bg-destructive/10`, `border-destructive/30`
  - Success → `text-success`, `bg-success/10`, `border-success/30`
  - Text → `text-text-main`, `text-text-muted`, `text-text-highlighted`, `text-text-disabled`
  - Surfaces → `bg-surface-body`, `bg-surface`, `bg-surface-raised`
  - Borders → `border-border`, `border-border-hover`, `border-border-selected`

- **Always use the `<Button>` component** from `@shared/components` — never use raw `<button>` with `interactive-*` classes directly:
  - `<Button>` (default, maps to `interactive-base`)
  - `<Button variant="primary">` (CTA, maps to `interactive-primary`)
  - `<Button variant="ghost">` (subtle, maps to `interactive-ghost`)
  - `<Button variant="icon">` (icon-only, maps to `interactive-icon`)
  - `<Button variant="destructive">` (dangerous, maps to `interactive-destructive`)
  - Supports `size="sm"`, `fullWidth`, and `forwardRef`. Flex centering + gap are baked in.

- **Use shared components before building custom ones.** Check `shared/components/` for: `Button`, `Modal`, `XButton`, `Toggle`, `MultiToggle`, `Dropdown`, `Notice`, `CollapsibleCard`, `LogoLink`.

- **Avoid inline `style={{}}` for layout and theming.** Use Tailwind classes. Inline styles are acceptable only for truly dynamic values (e.g., calculated positions, widths from state, or `backgroundColor` from a user color picker).

- **Use Tailwind shadow utilities** (`shadow-sm`, `shadow-panel`, `shadow-card`, `shadow-float`) instead of `style={{ boxShadow: '...' }}`.
