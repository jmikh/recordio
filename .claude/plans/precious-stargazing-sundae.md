# Convert Webapp to True SPA Navigation

## Context

The app already has SPA structure (single `index.html`, client-side routing in `App.tsx`, Cloudflare Pages catch-all redirect), but all navigation uses `window.location.href = "..."` which causes **full page reloads**. This defeats the purpose of an SPA — every navigation destroys all in-memory state, re-downloads JS, and restarts React. Converting to `history.pushState` enables long-running background processes to survive navigation, and makes page transitions instant.

## Plan

### Step 1: Create `navigate()` utility

**New file: `webapp/src/navigate.ts`**

A thin wrapper around `history.pushState` that dispatches a custom DOM event so `App.tsx` re-renders:

```ts
export function navigate(path: string, options?: { replace?: boolean }): void {
    if (options?.replace) {
        window.history.replaceState({}, '', path);
    } else {
        window.history.pushState({}, '', path);
    }
    window.dispatchEvent(new CustomEvent('navigate'));
}
```

`pushState` doesn't fire `popstate`, so the custom event is needed. The `{ replace: true }` option covers redirect cases (no-projectId, project-not-found) where back-navigation should be suppressed.

### Step 2: Update `App.tsx` router to listen for `navigate` event

**File: `webapp/src/App.tsx`**

Add `'navigate'` listener alongside existing `'popstate'`:

```ts
useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('navigate', handleNavigation);
    return () => {
        window.removeEventListener('popstate', handleNavigation);
        window.removeEventListener('navigate', handleNavigation);
    };
}, []);
```

### Step 3: Replace all internal `window.location.href` with `navigate()`

14 replacements across 9 files. Stripe redirects (external URLs) stay as-is.

| File | Line(s) | Change |
|------|---------|--------|
| `webapp/src/pages/DashboardPage.tsx` | 68, 184 | `navigate('/editor?projectId=...')` |
| `webapp/src/pages/ImportPage.tsx` | 59, 144, 314 | `navigate(...)` |
| `webapp/src/pages/WatchPage.tsx` | 154 | `navigate('/')` |
| `webapp/src/pages/MacHandoffPage.tsx` | 83, 181 | `navigate(...)` |
| `webapp/src/editor/App.tsx` | 178, 196 | `navigate('/', { replace: true })` and `navigate('/?error=...', { replace: true })` |
| `webapp/src/editor/App.tsx` | 296 | `navigate('/')` |
| `webapp/src/editor/components/header/Header.tsx` | 132 | `navigate('/')` |
| `webapp/src/components/SharedVideoCard.tsx` | 76 | `navigate('/editor?projectId=...')` |
| `webapp/src/bridge/macBridge.ts` | 84 | `navigate('/editor?projectId=...')` |

**NOT changed** — external redirects:
- `webapp/src/editor/stripe/StripeService.ts` (lines 59, 65, 105) — redirects to Stripe checkout URLs

### Step 4: Blob URL cleanup on editor exit

When navigating away from the editor without a full reload, blob URLs for video/audio sources leak. Add revocation in `useProjectStore.loadProject` so old blob URLs are cleaned up when a new project loads, and add cleanup in `App.tsx` when the route leaves `/editor`.

## Verification

Test these flows after implementation:
- Dashboard -> click project -> editor loads correctly
- Editor -> dashboard button -> projects list loads, media stops
- Browser back/forward buttons work
- Import flow -> editor redirect
- Deep link to `/editor?projectId=...` (fresh page load) still works
- `/?error=...` and `/?checkout=...` query params work
- Stripe checkout still redirects to external URL
- No blob URL memory leaks when navigating editor -> dashboard -> editor
