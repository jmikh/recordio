# Migrate Public Assets to CDN

## Context

The render-worker (server-side rendering) needs access to device frames, backgrounds, and sounds that currently live in `webapp/public/assets/`. These are served by Vite's dev server and are inaccessible from Node.js without a hacky `WEBAPP_BASE_URL` workaround. Moving all public assets to `cdn.recordio.cc` (Cloudflare R2) gives both browser and server a single, absolute URL for every asset. Music and demo videos already live there.

---

## Plan

### 1. Upload assets to Cloudflare R2

Upload the following from `webapp/public/assets/` to the R2 bucket behind `cdn.recordio.cc`:

```
backgrounds/bg1.avif, bg1-small.avif, ..., bg15.avif, bg15-small.avif  (30 files)
devices/macbook.png, macbook-small.png, macbook-dark.png, macbook-dark-small.png,
        studio-display.png, studio-display-small.png, ipad.png, ipad-small.png  (8 files)
sounds/mouse-click.mp3, mouse_down.mp3, mouse_up.mp3  (3 files)
```

**Note:** Device thumbnails are currently named `*-minified.png`. Rename to `*-small.png` on upload for consistency with backgrounds.

**Manual step** — use `wrangler r2 object put` or the Cloudflare dashboard.

### 2. Update device frame URLs

**File:** `shared/utils/deviceFrames.ts`

Change relative paths to absolute CDN URLs and update the thumbnail suffix from `-minified` to `-small`:

```ts
// Before
'/assets/devices/macbook.png'
imageUrl.replace('.png', '-minified.png')

// After
'https://cdn.recordio.cc/devices/macbook.png'
imageUrl.replace('.png', '-small.png')
```

All 4 frames: macbook, macbook-dark, studio-display, ipad.

### 3. Update background preset URLs

**File:** `webapp/src/editor/components/settings/BackgroundSettings.tsx`

Change `BACKGROUND_IMAGES` array from relative to absolute CDN URLs:

```ts
// Before
{ name: 'Dark Glass', url: '/assets/backgrounds/bg4.avif', thumbnail: '/assets/backgrounds/bg4-small.avif' }

// After
{ name: 'Dark Glass', url: 'https://cdn.recordio.cc/backgrounds/bg4.avif', thumbnail: 'https://cdn.recordio.cc/backgrounds/bg4-small.avif' }
```

### 4. Update default background imageUrl

**File:** `webapp/src/core/Project.ts` (line ~107)

```ts
// Before
imageUrl: '/assets/backgrounds/bg10.avif'

// After
imageUrl: 'https://cdn.recordio.cc/backgrounds/bg10.avif'
```

### 5. Update sound URLs

**File:** `webapp/src/core/audio/clickSoundPlayer.ts`

```ts
// Before
const CLICK_SOUND_URL = '/assets/sounds/mouse-click.mp3';
const MOUSE_DOWN_SOUND_URL = '/assets/sounds/mouse_down.mp3';
const MOUSE_UP_SOUND_URL = '/assets/sounds/mouse_up.mp3';

// After
const CLICK_SOUND_URL = 'https://cdn.recordio.cc/sounds/mouse-click.mp3';
const MOUSE_DOWN_SOUND_URL = 'https://cdn.recordio.cc/sounds/mouse_down.mp3';
const MOUSE_UP_SOUND_URL = 'https://cdn.recordio.cc/sounds/mouse_up.mp3';
```

### 6. Add project migration (v3 → v4): rewrite background imageUrl

Existing saved projects store `imageUrl: '/assets/backgrounds/bg10.avif'` (relative). These need to be rewritten to CDN URLs on load.

**File:** `webapp/src/core/migrateProject.ts`

Add after the v3 block:

```ts
// v3 → v4: rewrite preset background imageUrl from relative to CDN
if (version < 4) {
    const bgUrl = raw.settings?.background?.imageUrl;
    if (typeof bgUrl === 'string' && bgUrl.startsWith('/assets/backgrounds/')) {
        raw.settings.background.imageUrl = bgUrl.replace(
            '/assets/backgrounds/',
            'https://cdn.recordio.cc/backgrounds/'
        );
    }
}
```

**File:** `webapp/src/core/Project.ts` — bump `CURRENT_SCHEMA_VERSION` from 3 to 4.

### 7. Delete local asset files

Remove from `webapp/public/assets/`:
- `backgrounds/` (all 30 files)
- `devices/` (all PNGs + `thumbnails/` folder)
- `sounds/` (all 3 MP3s)

Keep: `images/`, `tooltips/`, `icons/` (these are webapp-only UI assets, not rendering assets).

### 8. Update CDN skill

**File:** `.claude/skills/cdn/SKILL.md` — already created with the new structure. Verify it matches reality after upload.

---

## Files modified

| File | Change |
|------|--------|
| `shared/utils/deviceFrames.ts` | Absolute CDN URLs, `-small` suffix |
| `webapp/src/editor/components/settings/BackgroundSettings.tsx` | Absolute CDN URLs for BACKGROUND_IMAGES |
| `webapp/src/core/Project.ts` | Default imageUrl → CDN, bump schema version |
| `webapp/src/core/audio/clickSoundPlayer.ts` | Absolute CDN URLs for sounds |
| `webapp/src/core/migrateProject.ts` | v4 migration for background imageUrl |
| `webapp/public/assets/backgrounds/` | Delete |
| `webapp/public/assets/devices/` | Delete |
| `webapp/public/assets/sounds/` | Delete |

---

## Verification

1. **Upload first** — use wrangler or dashboard to put files in R2 under `backgrounds/`, `devices/`, `sounds/`
2. **Verify CDN** — `curl -I https://cdn.recordio.cc/devices/macbook.png` returns 200
3. **Start webapp** — `cd webapp && npm run dev`
4. **Device frames** — open a project with device mode, verify frame renders
5. **Backgrounds** — open background settings, verify preset thumbnails load, select one, verify full image renders
6. **Sounds** — enable click sounds, play back, verify sounds play
7. **Migration** — load an existing saved project with a preset background, verify the imageUrl was rewritten to CDN on load
8. **Export** — run a browser export with device frame + background + click sounds, verify output
