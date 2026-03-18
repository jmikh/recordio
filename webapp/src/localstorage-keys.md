# LocalStorage Keys Reference

All localStorage variables used across the codebase. Only the **webapp** uses localStorage — the extension does not.

| Key | Type | Purpose | Read by | Written by |
|---|---|---|---|---|
| `recordio-theme` | `'light' \| 'dark'` | Persisted theme preference | `useThemeStore.ts` | `useThemeStore.ts` |
| `recordio-user-storage` | JSON blob (legacy) | Legacy user storage — migrated to `recordio-theme` on first read, then ignored | `useThemeStore.ts` (read-only, migration) | — (legacy, no longer written) |
| `recordio-local-user-id` | UUID string | Anonymous local user ID for GA4 event attribution | `core/analytics/index.ts` | `core/analytics/index.ts` |
| `recordio-total-projects-created` | Numeric string | Running count of projects created (sent with `project_created` event) | `core/analytics/index.ts` | `core/analytics/index.ts` |
| `recordio:prefer-software-decode` | `'true' \| 'false'` | Persisted when hardware video decode fails — forces CPU decode on next export | `FrameExtractor.ts`, `useUIStore.ts` | `FrameExtractor.ts`, `useUIStore.ts` |
| `recordio-review-toast-shown` | `'true'` | One-shot guard — ensures the review modal is shown at most once per user | `ReviewModal.tsx` | `ReviewModal.tsx` |
