# Centralize localStorage access behind a single module

## Context

localStorage is accessed directly in 4 files (excluding `index.html` which stays raw) using raw string keys. This makes it easy to introduce typos, key collisions, and hard to see all persisted local state at a glance. IndexedDB is already centralized in `ProjectStorage` and stays as-is.

## Plan

### 1. Create `webapp/src/storage/localPreferences.ts`

A simple static class (matching `ProjectStorage`'s pattern) that owns all localStorage keys and exposes typed getters/setters:

```ts
export class LocalPreferences {
  // -- Theme --
  static getTheme(): 'light' | 'dark' | null
  static setTheme(theme: 'light' | 'dark'): void

  // -- Legacy theme migration (read-only) --
  static getLegacyTheme(): string | null

  // -- Video decode preference --
  static getPreferSoftwareDecode(): boolean
  static setPreferSoftwareDecode(value: boolean): void

  // -- Review modal --
  static hasShownReviewModal(): boolean
  static markReviewModalShown(): void
}
```

All localStorage keys live as private constants inside this file. No raw `localStorage` calls anywhere else.

### 2. Update consumers (4 files)

| File | Change |
|------|--------|
| `webapp/src/stores/useThemeStore.ts` | Replace `localStorage.getItem/setItem('recordio-theme')` and legacy key read with `LocalPreferences.getTheme()` / `setTheme()` / `getLegacyTheme()` |
| `webapp/src/editor/stores/useUIStore.ts` | Replace `localStorage.getItem/setItem(SW_DECODE_KEY)` with `LocalPreferences.getPreferSoftwareDecode()` / `setPreferSoftwareDecode()` |
| `webapp/src/editor/export/FrameExtractor.ts` | Same as above — replace `SW_DECODE_KEY` reads/writes with `LocalPreferences` calls |
| `webapp/src/editor/components/header/ReviewModal.tsx` | Replace `localStorage.getItem/setItem(REVIEW_TOAST_KEY)` with `LocalPreferences.hasShownReviewModal()` / `markReviewModalShown()` |

### 3. Leave alone

- `webapp/src/editor/index.html` — inline script runs before bundles, stays raw
- `webapp/src/storage/projectStorage.ts` — IndexedDB already centralized, no changes

## Verification

- `grep -r 'localStorage\.' webapp/src/ --include='*.ts' --include='*.tsx'` should return only `localPreferences.ts`
- App theme, video decode preference, and review modal behavior all work as before
- Run `npm run build` (or equivalent) to confirm no import errors
