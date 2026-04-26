---
name: cdn
description: CDN asset hosting at cdn.recordio.cc — why assets live on CDN (render module runs both locally and server-side for cloud rendering) and directory conventions. Use when adding, referencing, or modifying CDN-hosted assets, or working with asset URLs in project JSON or render code.
---

# CDN Skill — cdn.recordio.cc

Static public assets served via CDN at `https://cdn.recordio.cc/<folder>/<file>`.

## Why CDN?

The render module runs both **locally in the browser** and **server-side for cloud rendering**. Assets must be absolute CDN URLs so both environments can resolve them — relative paths or bundled assets won't work on the server.

## Directories

- **demos/** — Feature demo videos (tooltips & extension UI)
- **music/** — Background music presets
- **backgrounds/** — Background image presets (full-size + `-small` thumbnails)
- **devices/** — Device frame images (full-size + `-small` thumbnails)
- **sounds/** — UI sound effects

## Key conventions

- All assets are **immutable** — never overwrite, add new files instead
- URLs in project JSON must be **absolute CDN URLs**
- Thumbnails use the `-small` suffix (backgrounds and devices)
