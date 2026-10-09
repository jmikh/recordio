# Share link previews (Slack / iMessage / LinkedIn unfurls) — oneshot

## Goal

Pasting a public `https://app.recordio.io/video/{slug}` link into Slack (or
iMessage, LinkedIn, Discord, X…) shows a rich preview card: video title,
owner + duration, and a thumbnail with a play-button overlay — instead of
the bare "Recordio" text it shows today.

Mock of the chosen design ("B · Thumbnail + play overlay"):
https://claude.ai/artifact/PRts6eqNnSyLoe5eM5MHg2

Out of scope: inline playback inside Slack (needs a Slack app with
`chat.unfurl` video blocks), an `/embed` page and oEmbed endpoint,
screenshot share links (`/screenshot/{slug}`) — same mechanism, follow-up.

## Why nothing shows today

Unfurl bots don't run JavaScript. Every `/video/{slug}` request is served
the static SPA shell (`webapp/index.html` via the `/* /index.html 200`
rule in `webapp/public/_redirects`), whose only metadata is
`<title>Recordio</title>`. The tags have to be in the HTML the server
returns.

## Decisions (confirmed in chat, 2026-10-08)

| Decision | Choice | Why |
|---|---|---|
| Card design | B: thumbnail + dark tint + purple play button + "Recordio" chip + duration pill | Reads unmistakably as a video |
| Image source | Our own project thumbnail (`projects.thumbnail_storage_path` → `{created_by}/{projectId}/thumbnail.webp`), **not** Mux | Exists before the Mux render finishes; no Mux dependency |
| Duration | Computed from `project_data.timeline.outputWindows` via shared `TimeMapper.outputDuration` | No DB/webhook change; old videos get it too. Can drift from the rendered video if edited after publishing — same accepted drift as the transcript |
| Image composition | Fastify server + `sharp` | Server already reads the private bucket (`S3Port.getObject`); fits the ports/fakes test setup; bundled font = deterministic text |
| Thumbnail resolution | Raise editor capture from 480 px wide to 1200 px long edge | 480 px looks soft on 2× screens and on platforms that show previews larger |
| Non-public links | Generic card ("Recordio video", no title/owner) | Must not leak a private video's name |

## Design

```
Slack ──GET /video/{slug}──▶ Cloudflare Pages Function  functions/video/[slug].ts
                               │ 1. context.next()  → SPA index.html
                               │ 2. POST {API_URL}/shared-video-preview {slug}
                               │ 3. HTMLRewriter: <title> + og:/twitter: tags
                               ▼
                             HTML with tags ──▶ Slack
Slack ──GET og:image──▶ {API_URL}/shared-video-preview-image/{slug}  (Fastify)
                               │ S3 getObject(thumbnail.webp) → sharp composite → PNG
```

### 1. Server: `POST /shared-video-preview` (new route)

`server/src/routes/sharedVideoPreview.ts`. No auth (`optionalUser` not
needed — the preview is the anonymous view by definition).

- Request `{ slug }`; response `{ name, ownerName, durationMs? }`.
- `404 { error: 'not_found' }` for: missing slug, `deleted_at` set,
  `share_policy !== 'public'`. One answer for all three, so the function
  can't distinguish a private video from a nonexistent one (no existence
  leak to crawlers).
- Reads only `name, owner_id, share_policy` + the `outputWindows` jsonb
  path (never the whole `project_data`, same as `sharedVideoGet.ts`).
- Owner name: same `supabaseApi.getUserById` + `full_name ?? name ?? email`
  fallback as `sharedVideoGet.ts` (extract a tiny shared helper rather than
  copy it).
- Unlike `/shared-video-get` it NEVER dispatches a render or touches the
  publish budget — a crawler hit must be side-effect free.
- Rate limit: 60/min per IP (the Pages Function's egress IPs are
  Cloudflare's, but it also edge-caches, see §3).
- TypeBox schemas in `shared/api/projects.ts` next to the SharedVideoGet
  ones.

Duration helper: add `getOutputDurationMs(timeline)` to
`server/src/services/projectCaptions.ts` (it already has the `isWindow`
guard and `TimeMapper` import). Returns `undefined` when there are no
usable windows → the description and pill omit the duration.

### 2. Server: `GET /shared-video-preview-image/:slug` (new route)

`server/src/routes/sharedVideoPreviewImage.ts` — the first GET route on the
server (`og:image` is fetched with GET).

- Always returns `200 image/png`, 1200×675:
  - public + thumbnail present → the design-B composite;
  - anything else (private, missing, deleted, no thumbnail, S3 read
    failure) → the generic brand card. Never 404s, so a preview never shows
    a broken image, and never reveals whether a slug exists.
- `Cache-Control: public, max-age=3600`. No version param: the thumbnail
  path is overwritten in place and Slack keeps its own copy of the image
  per unfurl anyway.
- Rate limit: 60/min per IP.

Composition lives in a pure service, `server/src/services/sharePreviewImage.ts`
(buffer in → PNG buffer out; no deps object, so it is tested with real
sharp):

- `renderVideoPreviewCard({ thumbnail, durationMs? })`:
  1. `sharp(thumbnail).resize(1200, 675, { fit: 'contain', background: '#4B36B8' })`
     — 16:9 recordings fill the frame; portrait/square outputs letterbox on
     brand purple. Old 480 px thumbnails get upscaled (soft until the owner
     next opens the editor — acceptable).
  2. Composite, in order: 22% dark tint (`rgba(20,12,40,0.22)`); play button
     (SVG: 192 px `#7D5EE0` disc, 9 px white ring, white triangle);
     "Recordio" chip top-left (dark pill + logo paths + wordmark);
     duration pill bottom-right (`m:ss` / `h:mm:ss`), only when
     `durationMs` is known.
- `renderGenericPreviewCard()`: `#4B36B8` ground, centred cream logo +
  "Recordio" wordmark. Rendered once and memoised.
- Text (wordmark, duration) via sharp's `text` input with
  `fontfile` → a bundled `server/assets/fonts/Manrope-ExtraBold.ttf` (OFL;
  same family as the app). Railway's image can't be relied on for system
  fonts. Resolve the font path so it works under both `tsx src/` (dev) and
  `node dist/server.js` (prod) — tsup doesn't copy assets.
- Logo: paths copied from `shared/assets/logo.svg` into a constant.

Dependency: add `sharp` to `server/package.json` dependencies (prebuilt
linux-x64 binaries; already used at the repo root for scripts).

### 3. Cloudflare Pages Function: `functions/video/[slug].ts`

`[slug]` matches exactly one segment, so `/video/{slug}/edit` is untouched.

- `onRequestGet`: `const res = await context.next()` (the SPA shell via
  `_redirects`). Pass `res` through unchanged unless it is a 200 HTML
  response.
- Fetch preview data: `POST ${env.API_URL}/shared-video-preview`, 1.5 s
  timeout (`AbortSignal.timeout`). Edge-cache the JSON for 60 s with
  `caches.default` under a synthetic GET key
  (`https://cache.internal/shared-video-preview/{slug}`) so busy links
  don't hit Railway per view.
- ANY failure (missing `API_URL`, timeout, 5xx, bad JSON) → return `res`
  unchanged + `console.error`. The page must never break because the
  preview did.
- Tags (all values HTML-escaped — the title is user content):

  | Tag | Public | Not public / 404 |
  |---|---|---|
  | `<title>` | `{name} · Recordio` | `Recordio` |
  | `og:site_name` | Recordio | Recordio |
  | `og:type` | `video.other` | `website` |
  | `og:title` / `twitter:title` | `{name}` | `Recordio video` |
  | `og:description` / `twitter:description` / `description` | `{ownerName} · {m:ss}` | `This video is shared privately. Sign in to Recordio to watch.` |
  | `og:url` | canonical `https://{host}/video/{slug}` | same |
  | `og:image` / `twitter:image` | `${API_URL}/shared-video-preview-image/{slug}` | same URL (serves the generic card) |
  | `og:image:width` / `height` / `type` / `alt` | 1200 / 675 / image/png / `{name}` | 1200 / 675 / image/png / Recordio |
  | `twitter:card` | `summary_large_image` | `summary_large_image` |

- Inject with `HTMLRewriter`: replace `<title>` content, append the tags to
  `<head>`.
- Tag building is a pure function (`buildSharePreviewTags(meta, urls)`) in
  its own module so escaping and the duration format are unit-tested
  without the Workers runtime. (Check that Pages doesn't route a
  helper file inside `functions/`; if it does, put it outside and import
  relatively — `functions/sentry/index.ts` already imports across folders.)
- Env: `API_URL` set in the Cloudflare Pages project settings
  (production = `https://recordio-production.up.railway.app`, plus preview).
  Local: `.dev.vars` for `wrangler pages dev`.

### 4. Editor: bigger thumbnail

`webapp/src/editor/components/canvas/CanvasContainer.tsx:335-357` — replace
the 480 px max width with a 1200 px **long-edge** cap
(`scale = Math.min(1200 / Math.max(w, h), 1)`), so landscape → 1200×675 and
portrait → 675×1200. The canvas is already at output resolution
(`outputSize`, default 1920×1080), so there is real detail to keep.

Size check: a 1200×675 webp at q0.8 of a screen recording should land
~60–200 KB, under the 500 KB server cap — verify on a busy frame; drop the
quality to 0.75 if not. Trade-off: dashboard cards download larger
thumbnails (they're cached locally by `BlobCache`); acceptable.

## Implementation steps

1. Server: `getOutputDurationMs` + owner-name helper + `POST
   /shared-video-preview` with schemas and tests.
2. Server: add `sharp` + font asset; `sharePreviewImage.ts` service with
   tests; `GET /shared-video-preview-image/:slug` route with tests.
   Register both routes in `app.ts`.
3. Pages Function `functions/video/[slug].ts` + pure tag builder + tests.
4. Editor thumbnail capture → 1200 px long edge.
5. Local verification (below), then set `API_URL` in Cloudflare Pages and
   deploy; verify in real Slack on a preview deployment before production.

## Testing

- **Server unit (vitest, fake deps):**
  - preview route: public → data (with/without duration); private /
    workspace / deleted / unknown → identical 404; no render dispatched.
  - image route: public + thumbnail → PNG 1200×675; private, unknown, no
    thumbnail, S3 failure → generic card PNG; `Cache-Control` set.
  - `sharePreviewImage`: output dimensions for 16:9, portrait and tiny
    (480 px) inputs; duration formatting (`0:07`, `3:42`, `1:02:03`).
- **Tag builder unit:** escaping of `<>"'&` in names; generic vs public
  variants; duration omitted when unknown.
- **Manual / local:** build the webapp, run `npx wrangler pages dev
  webapp/dist` with `.dev.vars` pointing at the local server;
  `curl -A Slackbot http://localhost:8788/video/{slug}` shows the tags;
  open the image URL in a browser; confirm `/video/{slug}/edit` and a
  normal browser visit still load the app.
- **Real Slack:** paste a preview-deployment link for a public, a private
  and a still-rendering video.

## Risks / gotchas

- **`context.next()` + `_redirects`:** expected to return the SPA shell for
  `/video/{slug}` — confirm locally before relying on it.
- **Slack caches unfurls** per URL for a while: a rename or new thumbnail
  won't show on already-posted links.
- **Old thumbnails are 480 px** until the owner reopens the editor.
- **Projects never opened in the editor have no thumbnail** → generic card.
- **sharp text rendering** depends on the bundled font loading via
  `fontfile`; covered by the service tests, which run the real renderer.
