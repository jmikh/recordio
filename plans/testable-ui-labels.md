# Testable UI: accessible labels everywhere tests (and users) need them

## Why

E2e tests (`e2e/`) select elements by accessible semantics — role, label,
visible text. Today almost nothing in the app is labeled: **18** icon-variant
`Button`s (2 have any label), **13** raw `<input>`s (0 with `aria-label`),
**11** `Modal`s with no `role="dialog"`, toasts with no live-region role.
Tests fall back to placeholder text and DOM structure, which break on copy or
styling changes. Fixing labels once makes every future test cheaper to write
and doubles as screen-reader accessibility.

Conventions live in the ui-guidelines skill ("Labels & Testability"). Label
wording = what the user perceives ("Close", "Record", "Search projects"),
sentence case; renaming a label is a breaking change for tests.

## Phase 1 — shared components (single-point fixes, propagate everywhere)

| Component | Change |
|---|---|
| `Toast.tsx` (webapp) | Toast root: `role="alert"` for `type==='error'`, `role="status"` otherwise. Covers all 56 `addToast` callsites at once; tests can await `getByRole('alert')` generically. |
| `Modal.tsx` | `role="dialog"` + `aria-modal="true"` on the panel; add optional `ariaLabel` prop (fall back to nothing rather than a wrong guess). |
| `XButton.tsx` | Mirror the existing `title` prop into `aria-label` (`aria-label={title}`) — default "Remove" already reads correctly. |
| `Button.tsx` | No code change (`aria-*` passes through via `ButtonHTMLAttributes`). Optional: dev-only `console.warn` when `variant="icon"` with no children and no `aria-label`/`title`, to catch new unlabeled buttons. |
| `Dropdown.tsx` | `aria-label` prop on the trigger; menu items are text already. |
| `Checkbox.tsx` / `Slider.tsx` | Wire the visible label to the input (proper `<label htmlFor>` or `aria-label`). `Toggle` already has `role="switch"`. |

## Phase 2 — app surfaces, in e2e-priority order

Ordered to match the tests we're about to write; each item unblocks selectors
for a planned spec.

1. **AuthModal** (already tested): `aria-label="Email"` / `"Password"` on the
   dev-login inputs → switch `auth.setup.ts` from `getByPlaceholder` to
   `getByLabel` in the same change.
2. **Billing** (next e2e target — Stripe subscribe): `BillingPage`,
   `ProUpgradeModal`, `ProGate` — label the upgrade/manage/interval/plan
   buttons; make plan state ("Pro", seats, renewal date) visible text, not
   just styling.
3. **Dashboard**: search input (`aria-label="Search projects"`), Record
   button, project cards (`aria-label` = project name on the clickable card),
   sidebar nav + trash, workspace switcher.
4. **Editor header/toolbar**: the icon-button cluster (undo/redo, export,
   share, settings…) — most of the 16 unlabeled icon buttons live here.
5. **Everything else on demand**: label elements when a test first needs
   them, not in a big sweep. Canvas-internal editor UI (timeline blocks,
   bounding boxes) may need `data-testid` — that's the sanctioned last resort.

## Phase 3 — keep it from regressing

- Update existing e2e selectors to `getByRole`/`getByLabel` as labels land
  (placeholder-based selectors are deprecated on touch).
- Evaluate `eslint-plugin-jsx-a11y` with a minimal ruleset
  (`control-has-associated-label`, `aria-props`) — adopt only if the signal:noise
  is good on this codebase.

## Non-goals

- Full WCAG audit (focus order, contrast, keyboard nav) — separate effort.
- Labels for purely decorative icons/illustrations.
- Rewriting components that already have accessible semantics (Toggle).

## Acceptance

- Phase 1: every shared component renders correct roles/labels; existing e2e
  suite still green.
- Phase 2 items 1–3: auth, billing, and dashboard specs use only
  `getByRole`/`getByLabel`/visible text — zero placeholder or structural
  selectors.
