# End-to-end tests (Playwright)

Browser tests that drive the real webapp UI — the automated version of the
manual click-throughs (sign in, open the dashboard, visit billing, …).

## Prerequisites

The e2e suite starts the **webapp** for you (via Playwright's `webServer`), but it
does **not** start the rest of the local stack. Before running, make sure these
are up (see the repo-root `START_LOCALLY.md`):

- **Supabase** — `supabase start` (needed for auth; without it, login hangs)
- **Fastify server** — `cd server && npm run dev` (needed for the dashboard /
  settings API calls)

Edge functions and the render worker are **not** needed for the current smoke
tests. Browsers are already installed via the render-worker's Playwright; if you
ever get a "browser not found" error, run `npx playwright install chromium`.

## Running

```bash
npm run test:e2e          # headless, all tests
npm run test:e2e:ui       # interactive UI mode — best for developing tests
npm run test:e2e:headed   # watch it click through a real browser window
npm run test:e2e:report   # open the HTML report after a run
```

If you already have `npm run dev:webapp` running, the config reuses it instead of
starting a second one.

## How auth works

`tests/auth.setup.ts` runs first (it's a Playwright *setup project* dependency).
It signs in through the **dev login form** — the email/password box that
`webapp/src/auth/AuthModal.tsx` renders only in dev mode — and saves the browser
session to `e2e/.auth/user.json`. Every other test loads that session, so tests
start already authenticated instead of logging in each time.

Credentials default to the seeded local user in `.env.test`
(`user1@gmail.com` / `password123`). The dev form auto-creates the account on
first sign-in, so it works even on a fresh DB. Override with:

```bash
E2E_USER_EMAIL=you@example.com E2E_USER_PASSWORD=secret npm run test:e2e
```

## Writing tests

**Selectors — in priority order.** `getByRole(role, { name })` →
`getByLabel` → `getByPlaceholder` / `getByText` → `data-testid` (last resort)
→ never CSS/Tailwind classes (they change on every restyle).

**No label? Add one — don't work around it.** When a new test needs an element
that has no accessible label, the fix is to label the *component* (an
`aria-label`, a real `<label>`, or a stable id like `#project-name-input`) as
part of the same change — not to reach for placeholder text, `nth()`, or DOM
structure. Labeling conventions: ui-guidelines skill ("Labels & Testability")
and `plans/testable-ui-labels.md`.

**Arrange via API, act & assert via UI.** Don't click through setup a test
isn't about — seed the state through the backend (like
`fixtures/project.ts`) and spend the test on the behavior under test. Same for
teardown.

**Assert the outcome the test is named after — and little else.**
A visible title proves only "routing worked and render didn't crash"; that's
enough for a smoke test and nothing more. For a flow, assert the
*user-visible outcome*: async work finished (loading overlay gone), the data
actually shows (name input has the value), and — when persistence is the
point — that it survives a reload. Skip asserting static labels/copy: each
extra assertion couples the test to more UI and catches almost nothing.
A useful check when writing one: "if this passed but the feature were broken
for a real user, what did I forget?" (Usually a persistence or
async-completion check.)

**Don't re-test the lower layers.** Vitest already covers API shapes, time
mapping, migrations, etc. E2e's unique job is the wiring:
browser → UI → API → DB → back to UI. Few tests, deep, flow-shaped.

**Mechanics**

- Playwright auto-waits on `expect(...).toBeVisible()` etc. — never
  `waitForTimeout`.
- New authenticated specs need no boilerplate; they inherit the saved session.
  For an unauthenticated test, override per file:
  `test.use({ storageState: { cookies: [], origins: [] } })` (see
  `auth-gate.spec.ts`).
- Shared flows become helpers in `fixtures/` the *second* time a test needs
  them. No page-object classes until many tests share many interactions on
  the same complex screen.

## Project seeding (editor tests)

`fixtures/project.ts` seeds a real, editor-openable project without the
extension: it signs the e2e user in via the Supabase auth REST API, uploads
`fixtures/assets/screen.webm` (a committed 2s test video) to the
`project-media` bucket with the service role key, builds the project struct
with the app's own `ProjectImpl.createFromSource` (so `schemaVersion` and
default settings never drift from the app), then calls `project-create-v2` +
`project-confirm-upload` on the Fastify server. `editor.spec.ts` uses it in
`beforeAll` and cleans up in `afterAll`.

Because `fullyParallel` is on, each worker runs its own `beforeAll` — parallel
editor tests each seed their own isolated project. That's intended.

## Next steps (not yet covered)

- **Subscribe to a plan (Stripe).** The upgrade button opens Stripe Checkout in a
  popup (`webapp/src/billing/StripeService.ts`). Outline:
  1. `const popup = await page.waitForEvent('popup')` after clicking upgrade;
  2. on the Stripe-hosted page, fill test card `4242 4242 4242 4242`, any future
     expiry / CVC, and submit;
  3. run `stripe listen --forward-to localhost:8080/stripe-webhooks` so the
     webhook flips the workspace to Pro;
  4. assert the billing page shows the Pro plan.

  Keep 1–2 tests going through the real hosted checkout (it's a third-party page
  and can be flaky), and drive plan changes *after* the first subscription via
  `stripe trigger` / webhook fixtures rather than re-clicking checkout each time.
