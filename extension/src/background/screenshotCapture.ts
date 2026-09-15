/**
 * @fileoverview Screenshot capture orchestration (plans/screenshots).
 *
 * The background owns the capture session: the popup only starts/cancels
 * it (it closes on blur, so nothing user-facing may depend on it staying
 * open) and the content script exposes page primitives (region overlay,
 * full-page scroll/settle).
 *
 * Modes:
 *   visible  — one chrome.tabs.captureVisibleTab, stored as returned by Chrome
 *   region   — content overlay → rect → captureVisibleTab → crop in the SW (Step 4)
 *   fullPage — content scroll/settle loop ↔ tiled captureVisibleTab → stitch (Step 5)
 *
 * All decoding/cropping/stitching happens here in the service worker with
 * OffscreenCanvas — no offscreen document (only one may exist and the
 * recorder owns it).
 *
 * Chrome throttles captureVisibleTab to MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
 * (2); every capture goes through throttledCaptureVisibleTab().
 */

import type { RawScreenshot } from '@shared/types';
import { buildImportUrl } from '@shared/types/bridge';
import {
    MSG_TYPES,
    STORAGE_KEYS,
    type FullPagePrepareResult,
    type FullPageScrollToPayload,
    type FullPageScrollToResult,
    type PageInfo,
    type RegionSelectedPayload,
    type ScreenshotMode,
    type ScreenshotState,
} from '../shared/messageTypes';
import { ProjectStorage } from '../storage/projectStorage';
import { captureException } from '../utils/sentry';
import { trackScreenshotCaptured, trackScreenshotError } from '../utils/mixpanel';
import {
    allocateTileBudget,
    computeCanvasLayout,
    footerOp,
    nextTileY,
    overlapFor,
    planTileYs,
    stripTileOp,
    viewportRectOp,
    windowTileOp,
} from '../shared/fullPagePlan';
import { FullPageStitcher } from './fullPageStitcher';

/** chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND === 2 → ≥500 ms apart, with margin */
const CAPTURE_MIN_INTERVAL_MS = 510;
const ERROR_BADGE_COLOR = '#FF6B35';
const PROGRESS_BADGE_COLOR = '#f2b036';

const ERROR_MESSAGES: Record<string, string> = {
    'Cannot access contents of the page': 'Chrome does not allow capturing this page.',
    'activeTab permission is not in effect': 'Chrome does not allow capturing this page.',
    'The tab was closed': 'The tab was closed before the capture finished.',
};

// ============================================================================
// Session
// ============================================================================

export interface ScreenshotSession {
    mode: ScreenshotMode;
    tabId: number;
    windowId: number;
    startedAt: number;
    cancelled: boolean;
}

let session: ScreenshotSession | null = null;

/** The active capture session, if any (steps 4–5 read this from their message handlers). */
export function getScreenshotSession(): ScreenshotSession | null {
    return session;
}

export function isScreenshotActive(): boolean {
    return session !== null;
}

async function setScreenshotState(state: ScreenshotState | null): Promise<void> {
    if (state) {
        await chrome.storage.session.set({ [STORAGE_KEYS.SCREENSHOT_STATE]: state });
    } else {
        await chrome.storage.session.remove(STORAGE_KEYS.SCREENSHOT_STATE);
    }
}

/** A restarted service worker has no session — never leave a stale "capturing" state behind. */
export function resetScreenshotStateOnStartup(): void {
    session = null;
    void setScreenshotState(null);
    void chrome.action.getBadgeText({}).then((text) => {
        if (text.endsWith('%')) chrome.action.setBadgeText({ text: '' });
    });
}

async function updateScreenshotProgress(done: number, total: number): Promise<void> {
    if (!session) return;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    chrome.action.setBadgeText({ text: `${pct}%` });
    chrome.action.setBadgeBackgroundColor({ color: PROGRESS_BADGE_COLOR });
    chrome.action.setBadgeTextColor({ color: '#000000' });
    await setScreenshotState({ active: true, mode: session.mode, tabId: session.tabId, progress: { done, total } });
}

// ============================================================================
// Content-script messaging
// ============================================================================

function sendToTab<T>(tabId: number, type: string, payload?: unknown): Promise<T> {
    return chrome.tabs.sendMessage(tabId, { type, payload }) as Promise<T>;
}

async function disableBlurMode(tabId: number): Promise<void> {
    await sendToTab(tabId, MSG_TYPES.BACKGROUND_CONTENT_DISABLE_BLUR_MODE).catch(() => undefined);
}

/** Region selection promise, resolved by the CONTENT_REGION_* messages routed from background.ts. */
let pendingRegion: { tabId: number; resolve: (sel: RegionSelectedPayload | null) => void } | null = null;

export function onRegionSelected(tabId: number | undefined, payload: RegionSelectedPayload): void {
    if (pendingRegion && pendingRegion.tabId === tabId) {
        const { resolve } = pendingRegion;
        pendingRegion = null;
        resolve(payload);
    }
}

export function onRegionCancelled(tabId: number | undefined): void {
    if (pendingRegion && pendingRegion.tabId === tabId) {
        const { resolve } = pendingRegion;
        pendingRegion = null;
        resolve(null);
    }
}

/** Escape during a full-page capture. */
export function onContentCancelled(tabId: number | undefined): void {
    const current = session;
    if (current && current.tabId === tabId) current.cancelled = true;
}

// ============================================================================
// Capture primitives
// ============================================================================

let lastCaptureAt = 0;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** captureVisibleTab spaced ≥510 ms apart; one retry if Chrome's quota still trips. */
export async function throttledCaptureVisibleTab(windowId: number): Promise<Blob> {
    const wait = CAPTURE_MIN_INTERVAL_MS - (Date.now() - lastCaptureAt);
    if (wait > 0) await sleep(wait);

    const capture = async () => {
        lastCaptureAt = Date.now();
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        return dataUrlToBlob(dataUrl);
    };

    try {
        return await capture();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
            await sleep(600);
            return capture();
        }
        throw err;
    }
}

/** Decodes in-process: `fetch(dataUrl)` counts as connect-src, which the extension CSP blocks. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) throw new Error('Malformed data URL');

    const header = dataUrl.slice(0, comma);
    const type = header.slice(5).split(';')[0] || 'image/png';
    const body = dataUrl.slice(comma + 1);

    if (!header.includes(';base64')) {
        return new Blob([decodeURIComponent(body)], { type });
    }

    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
}

/** Reads a PNG's pixel size without keeping the bitmap around. */
export async function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
}

/** Viewport/URL/DPR via executeScript (works without the content script); falls back to tab metadata. */
export async function getPageInfo(tab: chrome.tabs.Tab): Promise<PageInfo | null> {
    if (!tab.id) return null;
    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({
                url: location.href,
                title: document.title,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                devicePixelRatio: window.devicePixelRatio,
                visualScale: window.visualViewport?.scale ?? 1,
                scrollX: window.scrollX,
                scrollY: window.scrollY,
            }),
        });
        return (result as PageInfo) ?? null;
    } catch {
        return null;
    }
}

/** Page title (else hostname) — the initial screenshot name in the editor. */
export function screenshotNameFor(url: string | undefined, title: string | undefined): string {
    const trimmed = title?.trim();
    if (trimmed) return trimmed.slice(0, 80);
    try {
        if (url) return new URL(url).hostname || 'Screenshot';
    } catch {
        // not a URL
    }
    return 'Screenshot';
}

/** Makes sure the content script is present (tabs opened before install/update lack it). */
export async function ensureContentScript(tabId: number, contentScriptPath: string): Promise<void> {
    try {
        await chrome.tabs.sendMessage(tabId, { type: MSG_TYPES.BACKGROUND_CONTENT_GET_PAGE_INFO });
    } catch {
        await chrome.scripting.executeScript({ target: { tabId }, files: [contentScriptPath] });
    }
}

// ============================================================================
// Persist + hand off
// ============================================================================

export interface CaptureResult {
    blob: Blob;
    raw: Omit<RawScreenshot, 'kind' | 'id' | 'timestamp' | 'image'> & { image: { size: { width: number; height: number } } };
}

/** Stores the PNG + metadata (one item at a time, like recordings) and opens the import tab. */
export async function persistAndOpen(result: CaptureResult): Promise<RawScreenshot> {
    const id = crypto.randomUUID();
    const blobId = `shot-${id}-image`;
    const raw: RawScreenshot = {
        ...result.raw,
        kind: 'screenshot',
        id,
        timestamp: Date.now(),
        image: {
            storagePath: `recordio-blob://${blobId}`,
            mimeType: 'image/png',
            size: result.raw.image.size,
        },
    };

    await ProjectStorage.clearAll();
    await ProjectStorage.saveRecordingBlob(blobId, result.blob);
    await ProjectStorage.saveRawScreenshot(raw);

    await chrome.tabs.create({ url: buildImportUrl(id, chrome.runtime.id, 'screenshot') });
    return raw;
}

// ============================================================================
// Visible area
// ============================================================================

async function captureVisibleArea(tab: chrome.tabs.Tab): Promise<CaptureResult> {
    const info = await getPageInfo(tab);
    const blob = await throttledCaptureVisibleTab(tab.windowId);
    const size = await readImageSize(blob);
    const viewport = info?.viewport ?? { width: size.width, height: size.height };
    const dpr = info?.devicePixelRatio ?? 1;
    return {
        blob,
        raw: {
            name: screenshotNameFor(info?.url ?? tab.url, info?.title ?? tab.title),
            captureMode: 'visible',
            image: { size },
            page: {
                url: info?.url ?? tab.url ?? '',
                title: info?.title ?? tab.title ?? '',
                viewport,
                devicePixelRatio: dpr,
                scale: viewport.width > 0 ? size.width / viewport.width : dpr,
            },
        },
    };
}

// ============================================================================
// Region
// ============================================================================

function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}

async function cropBlob(blob: Blob, selection: RegionSelectedPayload): Promise<{ blob: Blob; size: { width: number; height: number }; scale: number }> {
    const bitmap = await createImageBitmap(blob);
    try {
        const scaleX = bitmap.width / selection.viewport.width;
        const scaleY = bitmap.height / selection.viewport.height;
        const sx = clampInt(selection.rect.x * scaleX, 0, bitmap.width - 1);
        const sy = clampInt(selection.rect.y * scaleY, 0, bitmap.height - 1);
        const sw = clampInt(selection.rect.width * scaleX, 1, bitmap.width - sx);
        const sh = clampInt(selection.rect.height * scaleY, 1, bitmap.height - sy);

        const canvas = new OffscreenCanvas(sw, sh);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        const out = await canvas.convertToBlob({ type: 'image/png' });
        return { blob: out, size: { width: sw, height: sh }, scale: scaleX };
    } finally {
        bitmap.close();
    }
}

/** Runs after the popup has been acked: waits for the drag, captures, crops, persists. */
async function completeRegionCapture(tab: chrome.tabs.Tab, current: ScreenshotSession, selectionPromise: Promise<RegionSelectedPayload | null>): Promise<void> {
    try {
        const selection = await selectionPromise;
        if (!selection || current.cancelled) {
            await endScreenshotSession();
            return;
        }

        const info = await getPageInfo(tab);
        const full = await throttledCaptureVisibleTab(tab.windowId);
        const cropped = await cropBlob(full, selection);

        await persistAndOpen({
            blob: cropped.blob,
            raw: {
                name: screenshotNameFor(info?.url ?? tab.url, info?.title ?? tab.title),
                captureMode: 'region',
                image: { size: cropped.size },
                page: {
                    url: info?.url ?? tab.url ?? '',
                    title: info?.title ?? tab.title ?? '',
                    viewport: selection.viewport,
                    devicePixelRatio: selection.devicePixelRatio,
                    scale: cropped.scale,
                },
                region: selection.rect,
            },
        });
        trackScreenshotCaptured({
            mode: 'region',
            width: cropped.size.width,
            height: cropped.size.height,
            duration_ms: Date.now() - current.startedAt,
        });
        await endScreenshotSession();
    } catch (err) {
        await failScreenshot('region', err);
    }
}

// ============================================================================
// Full page
// ============================================================================

interface CapturedTile {
    scrolled: FullPageScrollToResult;
    bitmap: ImageBitmap;
}

/**
 * Strips in order: the window (always at least tile 0 — on a page that
 * doesn't scroll that is the base the inner scrollers are composed onto),
 * each inner scroller, then the footer pass that puts bottom-anchored fixed
 * elements at the page bottom. Every strip owns a canvas region that window
 * tiles never paint into, so draw order can't clobber a strip. Targets are
 * planned from where the previous tile actually landed (browser clamping,
 * reflow); the page height is adopted after tiles 1–2 and frozen after that
 * so infinite feeds terminate. Design: plans/full-page-capture-oneshot.md.
 */
async function runFullPageCapture(tab: chrome.tabs.Tab, current: ScreenshotSession, contentScriptPath: string): Promise<void> {
    const tabId = tab.id!;
    let prepared = false;
    try {
        await ensureContentScript(tabId, contentScriptPath);
        await disableBlurMode(tabId);
        await setScreenshotState({ active: true, mode: 'fullPage', tabId, progress: { done: 0, total: 0 } });

        const prep = await sendToTab<FullPagePrepareResult & { error?: string }>(tabId, MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_PREPARE);
        prepared = true;
        if (prep.error) throw new Error(prep.error);

        if (prep.pinchZoomed || (!prep.document.scrollable && prep.strips.length === 0)) {
            // Nothing to tile (or tiling math would be wrong) — take the visible area instead.
            await sendToTab(tabId, MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_FINISH).catch(() => undefined);
            prepared = false;
            const result = await captureVisibleArea(tab);
            await persistAndOpen(result);
            trackScreenshotCaptured({ mode: 'fullPage', width: result.raw.image.size.width, height: result.raw.image.size.height, duration_ms: Date.now() - current.startedAt, tile_count: 1 });
            await endScreenshotSession();
            return;
        }

        const vh = prep.viewportHeight;
        const overlap = overlapFor(prep.devicePixelRatio);
        let docH = prep.document.scrollHeight;
        const stripHeights = prep.strips.map((st) => st.scrollHeight);
        const windowMaxY = () => (prep.document.scrollable ? Math.max(0, docH - vh) : 0);
        const liveLayout = () => computeCanvasLayout({
            ...prep,
            document: { ...prep.document, scrollHeight: docH },
            strips: prep.strips.map((st, i) => ({ ...st, scrollHeight: stripHeights[i] })),
        });
        const liveBudget = () => allocateTileBudget(
            prep.document.scrollable ? planTileYs(docH, vh, prep.headerHeight, overlap).length : 1,
            prep.strips.map((st, i) => planTileYs(stripHeights[i], st.clientHeight, 0, overlap).length),
            prep.hasBottomFixed,
        );

        let layout = liveLayout();
        let budget = liveBudget();
        let truncated = budget.truncated;
        const total = budget.window + budget.strips.reduce((a, b) => a + b, 0) + (budget.footer ? 1 : 0);
        let stitcher: FullPageStitcher | null = null;
        let done = 0;
        let replanned = false;
        let cancelled = false;

        const canvasOf = (): FullPageStitcher => {
            if (!stitcher) throw new Error('Stitcher not initialised');
            return stitcher;
        };
        const applyLayout = () => {
            const c = canvasOf();
            c.ensureHeight(layout.heightCss);
            for (const f of layout.fills) c.fillCss(f.rect, f.color);
        };
        const relayout = () => {
            layout = liveLayout();
            budget = liveBudget();
            truncated = truncated || budget.truncated;
            replanned = true;
            applyLayout();
        };
        const captureTile = async (payload: FullPageScrollToPayload): Promise<CapturedTile | null> => {
            if (current.cancelled) return null;
            const scrolled = await sendToTab<FullPageScrollToResult>(tabId, MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_SCROLL_TO, payload);
            if (scrolled.cancelled || current.cancelled) return null;
            const blob = await throttledCaptureVisibleTab(tab.windowId);
            if (current.cancelled) return null;
            const bitmap = await createImageBitmap(blob);
            if (!stitcher) {
                stitcher = new FullPageStitcher(bitmap.width, prep.viewportWidth, prep.pageBackground);
                applyLayout();
            }
            return { scrolled, bitmap };
        };
        const finishTile = async () => {
            done++;
            await updateScreenshotProgress(done, total);
        };

        // ── Window strip ─────────────────────────────────────────────────
        let prevY = 0;
        for (let i = 0; ; i++) {
            if (i >= budget.window) {
                truncated = true;
                break;
            }
            const target = i === 0 ? 0 : nextTileY(prevY, vh, prep.headerHeight, overlap, windowMaxY());
            const tile = await captureTile({ phase: 'tile', strip: -1, windowY: target, tileIndex: done, tileCount: total });
            if (!tile) {
                cancelled = true;
                break;
            }
            try {
                if ((i === 1 || i === 2) && tile.scrolled.documentHeight !== docH) {
                    docH = tile.scrolled.documentHeight;
                    relayout();
                }
                const c = canvasOf();
                c.draw(windowTileOp({
                    tileIndex: i,
                    scrollY: tile.scrolled.scrollY,
                    headerH: prep.headerHeight,
                    bitmapW: tile.bitmap.width,
                    bitmapH: tile.bitmap.height,
                    scale: c.scale,
                    s: c.s,
                    owned: layout.owned,
                }), tile.bitmap);
            } finally {
                tile.bitmap.close();
            }
            prevY = tile.scrolled.scrollY;
            await finishTile();
            if (target >= windowMaxY()) break;
        }

        // ── Inner strips ─────────────────────────────────────────────────
        for (let j = 0; j < prep.strips.length && !cancelled; j++) {
            const st = prep.strips[j];
            const maxT = () => Math.max(0, stripHeights[j] - st.clientHeight);
            let prevTop = 0;
            for (let i = 0; ; i++) {
                if (i >= budget.strips[j]) {
                    truncated = true;
                    break;
                }
                const target = i === 0 ? 0 : nextTileY(prevTop, st.clientHeight, 0, overlap, maxT());
                const tile = await captureTile({ phase: 'tile', strip: j, windowY: st.windowY, scrollTop: target, tileIndex: done, tileCount: total });
                if (!tile) {
                    cancelled = true;
                    break;
                }
                try {
                    const live = tile.scrolled.stripScrollHeight;
                    if (i === 1 && live !== undefined && live !== stripHeights[j]) {
                        stripHeights[j] = live;
                        relayout();
                    }
                    const box = tile.scrolled.box;
                    if (box && box.width > 0 && box.height > 0) {
                        const c = canvasOf();
                        const scrollTop = tile.scrolled.scrollTop ?? target;
                        c.draw(stripTileOp({ box, scrollY: tile.scrolled.scrollY, scrollTop, scale: c.scale, s: c.s }), tile.bitmap);
                        if (i === 0) {
                            // Rows below the box in this capture belong under the expanded content
                            const tail = layout.tails.find((t) => t.strip === st.index);
                            if (tail) {
                                c.draw(viewportRectOp({
                                    rect: { ...tail.src, y: tail.src.y - tile.scrolled.scrollY },
                                    dstXCss: tail.src.x,
                                    dstYCss: tail.dstY,
                                    scale: c.scale,
                                    s: c.s,
                                }), tile.bitmap);
                            }
                        }
                    }
                } finally {
                    tile.bitmap.close();
                }
                prevTop = tile.scrolled.scrollTop ?? target;
                await finishTile();
                if (target >= maxT()) break;
            }
        }

        // ── Footer pass ──────────────────────────────────────────────────
        if (!cancelled && stitcher) {
            const c = canvasOf();
            c.cropToDrawn();
            if (budget.footer) {
                const tile = await captureTile({ phase: 'footer', strip: -1, windowY: windowMaxY(), tileIndex: done, tileCount: total });
                if (!tile) {
                    cancelled = true;
                } else {
                    try {
                        for (const rect of tile.scrolled.footerRects ?? []) {
                            c.draw(footerOp({ rect, vh, canvasHeightPx: c.height, scale: c.scale, s: c.s }), tile.bitmap);
                        }
                    } finally {
                        tile.bitmap.close();
                    }
                    await finishTile();
                }
            }
        }

        await sendToTab(tabId, MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_FINISH).catch(() => undefined);
        prepared = false;

        if (cancelled || current.cancelled || !stitcher || done === 0) {
            await endScreenshotSession();
            return;
        }

        const c = canvasOf();
        const blob = await c.finalize();
        const info = await getPageInfo(tab);
        await persistAndOpen({
            blob,
            raw: {
                name: screenshotNameFor(info?.url ?? tab.url, info?.title ?? tab.title),
                captureMode: 'fullPage',
                image: { size: { width: c.width, height: c.height } },
                page: {
                    url: info?.url ?? tab.url ?? '',
                    title: info?.title ?? tab.title ?? '',
                    viewport: { width: prep.viewportWidth, height: vh },
                    devicePixelRatio: prep.devicePixelRatio,
                    scale: c.scale * c.s,
                },
                fullPage: {
                    documentSize: { width: prep.document.scrollWidth, height: docH },
                    tileCount: done,
                    truncated,
                    downscaled: c.wasDownscaled,
                    stripCount: prep.strips.length,
                    headerHeight: prep.headerHeight,
                    replanned,
                },
            },
        });
        trackScreenshotCaptured({
            mode: 'fullPage',
            width: c.width,
            height: c.height,
            duration_ms: Date.now() - current.startedAt,
            tile_count: done,
            truncated,
            downscaled: c.wasDownscaled,
            strip_count: prep.strips.length,
            header_clipped: prep.headerHeight > 0,
            replanned,
            walk_budget_hit: prep.walkBudgetHit,
            bottom_fixed: prep.hasBottomFixed,
        });
        await endScreenshotSession();
    } catch (err) {
        if (prepared) await sendToTab(tabId, MSG_TYPES.BACKGROUND_CONTENT_FULLPAGE_FINISH).catch(() => undefined);
        await failScreenshot('fullPage', err);
    }
}

// ============================================================================
// Entry points (called from background.ts)
// ============================================================================

export interface StartScreenshotResult {
    success: boolean;
    error?: string;
}

function isCapturableUrl(url: string | undefined): boolean {
    return !!url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://'));
}

function friendlyError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    for (const [needle, friendly] of Object.entries(ERROR_MESSAGES)) {
        if (message.includes(needle)) return friendly;
    }
    return message || 'Screenshot failed.';
}

/**
 * Starts a capture on the active tab. `visible` runs to completion before
 * resolving (the popup shows "Capturing…" on the row and closes when the
 * import tab takes focus). `region` / `fullPage` resolve as soon as the
 * page-side flow has started so the popup can close (Steps 4–5).
 */
export async function startScreenshot(
    mode: ScreenshotMode,
    opts: { isRecording: boolean; contentScriptPath: string },
): Promise<StartScreenshotResult> {
    if (opts.isRecording) return { success: false, error: 'Finish the recording first.' };
    if (session) return { success: false, error: 'A screenshot is already being captured.' };

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.windowId === undefined || !isCapturableUrl(tab.url)) {
        return { success: false, error: 'Cannot capture this page.' };
    }

    session = { mode, tabId: tab.id, windowId: tab.windowId, startedAt: Date.now(), cancelled: false };

    if (mode === 'visible') {
        try {
            const result = await captureVisibleArea(tab);
            await persistAndOpen(result);
            trackScreenshotCaptured({
                mode,
                width: result.raw.image.size.width,
                height: result.raw.image.size.height,
                duration_ms: Date.now() - session.startedAt,
            });
            return { success: true };
        } catch (err) {
            captureException(err instanceof Error ? err : new Error(String(err)));
            trackScreenshotError({ mode, error: err instanceof Error ? err.message : String(err) });
            return { success: false, error: friendlyError(err) };
        } finally {
            session = null;
        }
    }

    if (mode === 'region') {
        const current = session;
        try {
            await ensureContentScript(tab.id, opts.contentScriptPath);
            await disableBlurMode(tab.id);
            const selectionPromise = new Promise<RegionSelectedPayload | null>((resolve) => {
                pendingRegion = { tabId: tab.id!, resolve };
            });
            await sendToTab(tab.id, MSG_TYPES.BACKGROUND_CONTENT_START_REGION_SELECT);
            await setScreenshotState({ active: true, mode, tabId: tab.id, progress: null });
            void completeRegionCapture(tab, current, selectionPromise);
            return { success: true };
        } catch (err) {
            pendingRegion = null;
            session = null;
            captureException(err instanceof Error ? err : new Error(String(err)));
            return { success: false, error: friendlyError(err) };
        }
    }

    // fullPage: ack the popup right away; everything else runs in the background
    void runFullPageCapture(tab, session, opts.contentScriptPath);
    return { success: true };
}

/** Popup cancel: flag the session (loops check it after every await) and dismiss the region overlay. */
export async function cancelScreenshot(): Promise<boolean> {
    if (!session) return false;
    session.cancelled = true;
    if (session.mode === 'region') {
        await sendToTab(session.tabId, MSG_TYPES.BACKGROUND_CONTENT_CANCEL_REGION_SELECT).catch(() => undefined);
        onRegionCancelled(session.tabId);
    }
    return true;
}

/** Tab closed or navigated away mid-capture. */
export async function cancelScreenshotForTab(tabId: number): Promise<void> {
    if (session?.tabId === tabId) await cancelScreenshot();
}

/** Ends the session (success or failure) and clears the mirrored state/badge. */
export async function endScreenshotSession(): Promise<void> {
    session = null;
    chrome.action.setBadgeText({ text: '' });
    await setScreenshotState(null);
}

/**
 * Failure after the popup has closed (region/full page): mirror the
 * recording-failure UX — badge `!`, stored message, try to open the popup.
 */
export async function failScreenshot(mode: ScreenshotMode, err: unknown): Promise<void> {
    captureException(err instanceof Error ? err : new Error(String(err)));
    trackScreenshotError({ mode, error: err instanceof Error ? err.message : String(err) });
    await endScreenshotSession();
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: ERROR_BADGE_COLOR });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.storage.session.set({
        [STORAGE_KEYS.SCREENSHOT_ERROR]: { message: friendlyError(err) },
    });
    (chrome.action as unknown as { openPopup?: () => Promise<void> }).openPopup?.().catch(() => {});
}
