# System Architecture

Recordio is a screen-recording Chrome Extension with a hosted web editor, using a **3-tier monorepo** structure.

## Monorepo Layout

```
/shared     → Types, theme, shared components (consumed by both extension & webapp)
/extension  → Chrome Extension (recording, popup, content scripts, service worker)
/webapp     → Hosted Vite + React editor, dashboard, landing pages
/functions  → Cloudflare Pages Functions (reverse proxies)
```

## Services & Infrastructure

| Service | Purpose | Where to find |
|---|---|---|
| **Supabase** | Auth, Postgres DB, storage, cron jobs | `webapp/supabase/` (migrations, edge functions) |
| **Supabase Edge Functions** (Deno) | Server-side logic: checkout, webhooks, email, video streaming | `webapp/supabase/functions/` |
| **Stripe** | Payments — checkout sessions, subscriptions, lifetime purchases, webhooks | `webapp/supabase/functions/create-checkout-session/`, `stripe-webhooks/` |
| **Resend** | Transactional email (welcome emails, etc.) | `webapp/supabase/functions/_shared/emails/resend.ts` |
| **Cloudflare Pages** | Hosts the webapp (`app.recordio.cc`) | Deployed from `webapp/dist` |
| **Cloudflare Pages Functions** | Reverse proxies (e.g., Mixpanel) | `functions/mp/` |
| **Cloudflare Stream** | Video hosting for shared recordings | `webapp/supabase/functions/upload-to-stream/`, `delete-from-stream/` |
| **Mixpanel** | Product analytics (proxied through CF to bypass ad blockers) | `functions/mp/`, extension tracker in `extension/src/` |
| **Sentry** | Error tracking (extension + webapp) | Initialized in both apps |
| **GA4** | Landing page / marketing analytics | Landing page only |

## Extension ↔ Webapp Communication

The extension records video + user events locally, then hands off to the webapp via a **chunked port-streaming protocol** (bypasses Chrome's 64MB IPC limit). Media is stored in IndexedDB using the `recordio-blob://` internal protocol. See KI: "Hybrid Architecture and Media Handoff" for details.

## Key Patterns

- **Thin Extension**: Extension only records. All editing/rendering logic lives in the webapp.
- **Edge functions handle their own auth** — no middleware JWT verification at the Cloudflare/Supabase gateway level.
- **Supabase DB Webhooks** trigger edge functions (e.g., `send-welcome-email` fires on `auth.users` INSERT).
- **Email unsubscribe** uses signed JWTs with 1-year expiry via the `unsubscribe` edge function.
- **localStorage keys** are documented in [localstorage-keys.md](file:///Users/johnmikhail/Projects/recordio-all/recordio/webapp/src/localstorage-keys.md). Only the webapp uses localStorage.

## userEvents Separation (Critical)

`userEvents` (mouse clicks, keyboard events, drags, URL changes, etc.) are stored as part of the `Project` record in IndexedDB, but are **stripped out of `project` at runtime** by `useProjectStore.loadProject()` and held in a separate top-level store field `s.userEvents`.

**Why:** The undo/redo system (zundo) snapshots `s.project` on every mutation. userEvents are large and immutable — including them would bloat history.

**Rules:**
- **NEVER read `project.userEvents`** from store state — it will be `undefined`.
- **Read events from** `useProjectStore(s => s.userEvents)` or the `useUserEvents()` selector.
- **When passing a full project** to functions that need events (export, analytics), reconstruct: `{ ...project, userEvents: useProjectStore.getState().userEvents }`.
- **Auto-save** re-attaches `userEvents` before writing to IndexedDB (see subscription in `useProjectStore.ts`).
