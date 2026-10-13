/**
 * The screenshot canvas (plans/screenshots Step 8): renders the cropped
 * source + background frame + spotlight + annotations into a box scaled to
 * fit the container. The <canvas> itself only covers the on-screen part of
 * the box (plus overscan) at device resolution — a full-resolution canvas of
 * a long capture exceeds the GPU texture limit and redraws on the CPU.
 * Scale: fit-to-width (or the view-only zoom from the UI store: ⌘/ctrl + wheel and
 * trackpad pinch zoom around the cursor, the zoom controls around the
 * centre of the scroll area), and hosts the interactive layers. Pointer handling here covers
 * selection (hit-test) and drag-to-create (annotations and the one
 * spotlight); moving/resizing the selection is AnnotationLayer's job.
 *
 * Coordinates: annotations are uncropped source px. The layer wrapper is
 * offset by -frame.origin × scale (crop minus background padding) so a
 * DisplayMapper over the FULL source maps them straight to display px;
 * the outer box clips to the frame.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DisplayMapper } from '@shared/mappers/displayMapper';
import type { Rect, Size } from '@shared/types';
import type { ArrowOverlayItem, BlurOverlayItem, BorderOverlayItem, OverlayItem, OverlayItemType, TextOverlayItem } from '@shared/types/overlay';
import type { ScreenshotDoc, ScreenshotSpotlight } from '@shared/types/screenshot';
import { createDefaultItemInRect } from '../../editor/overlay/defaultItems';
import { DEFAULT_SPOTLIGHT_DIM_OPACITY, DEFAULT_SPOTLIGHT_FEATHER_PX } from '../core/createScreenshotDoc';
import { useScreenshotDoc, useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotUIStore, type ScreenshotTool } from '../store/useScreenshotUIStore';
import { renderScreenshot, supportsCanvasFilter } from '../render/renderScreenshot';
import {
    HIT_TOLERANCE_DISPLAY_PX,
    canvasWindow,
    centerItemAt,
    clampPoint,
    defaultSpotlightRect,
    effectiveCrop,
    fitScale,
    fullSourceRect,
    hitTestAnnotations,
    intersectRects,
    normalizeRect,
    rectContains,
    rectContainsRect,
    screenshotFrame,
    screenshotScales,
    type Point,
} from '../geometry';
import { AnnotationLayer } from './AnnotationLayer';
import { CropLayer } from './CropLayer';

const DRAG_THRESHOLD_DISPLAY_PX = 4;
const MIN_ITEM_PX = 8;
const MIN_TEXT_WIDTH_PX = 40;

/** Base overlay type each tool creates. */
const TOOL_ITEM_TYPE: Partial<Record<ScreenshotTool, OverlayItemType>> = {
    text: 'text', arrow: 'arrow', line: 'arrow', rect: 'border', ellipse: 'border', blur: 'blur',
};

/** A default-sized item for the tool, with the tool's variant applied. */
function defaultItemFor(tool: ScreenshotTool, doc: ScreenshotDoc, view: Rect): OverlayItem | null {
    const type = TOOL_ITEM_TYPE[tool];
    if (!type) return null;
    const base = createDefaultItemInRect(type, view, doc.annotationDefaults);
    switch (tool) {
        case 'line': return { ...(base as ArrowOverlayItem), headStyle: 'none' };
        case 'ellipse': return { ...(base as BorderOverlayItem), shape: 'ellipse', borderRadiusPx: [0, 0, 0, 0] };
        case 'blur': return { ...(base as BlurOverlayItem), mode: supportsCanvasFilter() ? 'blur' : 'pixelate' };
        default: return base;
    }
}

/** Whole-px rect spanned by a drag from a to b (at least MIN_ITEM_PX each way). */
function dragRect(a: Point, b: Point): Rect {
    const r = normalizeRect(a, b);
    return {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.max(MIN_ITEM_PX, Math.round(r.width)),
        height: Math.max(MIN_ITEM_PX, Math.round(r.height)),
    };
}

/** The tool's item spanning a drag from a to b. */
function itemFromDrag(tool: ScreenshotTool, doc: ScreenshotDoc, view: Rect, a: Point, b: Point): OverlayItem | null {
    const base = defaultItemFor(tool, doc, view);
    if (!base) return null;
    const rect = dragRect(a, b);
    switch (base.type) {
        case 'blur':
        case 'border':
            return { ...base, rectPx: rect };
        case 'arrow':
            return { ...base, tail: { x: Math.round(a.x), y: Math.round(a.y) }, head: { x: Math.round(b.x), y: Math.round(b.y) } };
        case 'text':
            return { ...(base as TextOverlayItem), topLeft: { x: rect.x, y: rect.y }, widthPx: Math.max(MIN_TEXT_WIDTH_PX, rect.width) };
    }
}

/** A new spotlight over `rect` with the default look. */
function newSpotlight(rect: Rect): ScreenshotSpotlight {
    return {
        id: crypto.randomUUID(),
        rectPx: rect,
        borderRadiusPx: [0, 0, 0, 0],
        dimOpacity: DEFAULT_SPOTLIGHT_DIM_OPACITY,
        featherPx: DEFAULT_SPOTLIGHT_FEATHER_PX,
    };
}

/** Extra canvas beyond the visible area, as a fraction of it per side — scrolling within it needs no redraw. */
const CANVAS_OVERSCAN = 0.5;

/** The on-screen part of the box (display px, relative to the box): inside the scroll area's client box, or the window. */
function visibleInBox(box: HTMLElement, scroller: HTMLElement | null): Rect | null {
    const b = box.getBoundingClientRect();
    let clip: Rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    if (scroller) {
        const s = scroller.getBoundingClientRect();
        clip = { x: s.left + scroller.clientLeft, y: s.top + scroller.clientTop, width: scroller.clientWidth, height: scroller.clientHeight };
    }
    const vis = intersectRects({ x: b.left, y: b.top, width: b.width, height: b.height }, clip);
    return vis && { ...vis, x: vis.x - b.left, y: vis.y - b.top };
}

// ---- TEMP [ScreenshotPerf] instrumentation — remove once the perf work lands ----

let gpuMaxTextureSize: number | null | undefined;

/** Source size and the GPU's max texture side (canvases/images above it can't be GPU-backed whole). */
function logPerfEnvironment(image: HTMLImageElement | ImageBitmap): void {
    if (gpuMaxTextureSize === undefined) {
        const gl = document.createElement('canvas').getContext('webgl');
        gpuMaxTextureSize = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : null;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    const w = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const h = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    console.log(
        `[ScreenshotPerf] source ${w}×${h} (${(w * h / 1e6).toFixed(1)} MP), GPU max texture ${gpuMaxTextureSize ?? 'unknown'}`
        + (gpuMaxTextureSize && Math.max(w, h) > gpuMaxTextureSize ? ' — source EXCEEDS it' : ''),
        `devicePixelRatio ${window.devicePixelRatio}`,
    );
}

/**
 * One line per draw: synchronous ms per paint phase, plus the time until the
 * next animation frame — GPU canvases defer rasterising, so that gap is where
 * deferred work and compositing the big canvas show up.
 */
function logDrawPerf(width: number, height: number, t0: number, perf: Record<string, number>): void {
    const sync = performance.now() - t0;
    requestAnimationFrame(() => {
        const nextFrame = performance.now() - t0;
        const phases = Object.entries(perf)
            .filter(([, ms]) => ms >= 0.05)
            .map(([phase, ms]) => `${phase} ${ms.toFixed(1)}`)
            .join(' · ');
        const over = gpuMaxTextureSize && Math.max(width, height) > gpuMaxTextureSize ? ' EXCEEDS GPU max texture' : '';
        console.log(
            `[ScreenshotPerf] draw ${width}×${height} (${(width * height / 1e6).toFixed(1)} MP)${over}`
            + ` | sync ${sync.toFixed(1)}ms → next frame ${nextFrame.toFixed(1)}ms | ${phases}`,
        );
    });
}

/** Per-event wheel zoom sensitivity (pinch deltas are a few px; a mouse notch ~100). */
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const WHEEL_ZOOM_MAX_STEP = 1.4;

interface ScreenshotCanvasProps {
    /** Decoded source image */
    image: HTMLImageElement | ImageBitmap;
    /** The scrollable area hosting the canvas — zoom keeps the cursor's point fixed inside it */
    scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export function ScreenshotCanvas({ image, scrollContainerRef }: ScreenshotCanvasProps) {
    const doc = useScreenshotDoc();
    const tool = useScreenshotUIStore(s => s.tool);
    const selectedId = useScreenshotUIStore(s => s.selectedId);
    const zoom = useScreenshotUIStore(s => s.zoom);
    const select = useScreenshotUIStore(s => s.select);
    const setTool = useScreenshotUIStore(s => s.setTool);
    const setFitScale = useScreenshotUIStore(s => s.setFitScale);
    const enterTextEdit = useScreenshotUIStore(s => s.enterTextEdit);
    const addAnnotation = useScreenshotStore(s => s.addAnnotation);
    const setSpotlight = useScreenshotStore(s => s.setSpotlight);

    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [draft, setDraft] = useState<OverlayItem | null>(null);
    const [spotlightDraft, setSpotlightDraft] = useState<ScreenshotSpotlight | null>(null);
    const dragRef = useRef<{ start: Point; moved: boolean; pointerId: number } | null>(null);

    // Fit-to-width: track the container
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => setContainerWidth(el.clientWidth);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const sourceSize: Size = useMemo(
        () => ({ width: doc?.source.widthPx ?? 1, height: doc?.source.heightPx ?? 1 }),
        [doc?.source.widthPx, doc?.source.heightPx],
    );
    const view: Rect = useMemo(() => {
        if (!doc) return fullSourceRect(sourceSize);
        return tool === 'crop' ? fullSourceRect(sourceSize) : effectiveCrop(doc);
    }, [doc, tool, sourceSize]);
    const bare = tool === 'crop';
    const frame = useMemo(() => screenshotFrame(doc?.background, view, bare), [doc?.background, view, bare]);
    const fit = fitScale(frame.size, containerWidth);
    const scale = zoom ?? fit;
    useEffect(() => { setFitScale(fit); }, [fit, setFitScale]);
    const displayWidth = frame.size.width * scale;
    const displayHeight = frame.size.height * scale;
    const { textScale } = screenshotScales(view.width);

    const mapper = useMemo(
        () => new DisplayMapper(sourceSize, { width: sourceSize.width * scale, height: sourceSize.height * scale }),
        [sourceSize, scale],
    );

    // ---- Drawing (rAF-coalesced; the preview ref's setter schedules one) ----
    const drawRef = useRef<() => void>(() => {});
    const frameRef = useRef<number | null>(null);
    const scheduleRedraw = useCallback(() => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            drawRef.current();
        });
    }, []);
    const previewItemRef = useMemo<React.MutableRefObject<OverlayItem | null>>(() => {
        let value: OverlayItem | null = null;
        return {
            get current() { return value; },
            set current(next: OverlayItem | null) { value = next; scheduleRedraw(); },
        };
    }, [scheduleRedraw]);
    const previewSpotlightRef = useMemo<React.MutableRefObject<ScreenshotSpotlight | null>>(() => {
        let value: ScreenshotSpotlight | null = null;
        return {
            get current() { return value; },
            set current(next: ScreenshotSpotlight | null) { value = next; scheduleRedraw(); },
        };
    }, [scheduleRedraw]);

    // The canvas covers only the on-screen part of the box (plus overscan) at
    // device resolution; `drawnRef` is the area it last painted.
    const drawnRef = useRef<{ display: Rect; dpr: number } | null>(null);
    drawRef.current = () => {
        const canvas = canvasRef.current;
        const box = boxRef.current;
        if (!canvas || !box || !doc) return;
        // TEMP [ScreenshotPerf]
        const perf: Record<string, number> = {};
        const t0 = performance.now();
        const dpr = window.devicePixelRatio || 1;
        const visible = visibleInBox(box, scrollContainerRef?.current ?? null);
        const win = visible && canvasWindow(visible, { width: displayWidth, height: displayHeight }, scale, dpr, CANVAS_OVERSCAN);
        drawnRef.current = win && { display: win.display, dpr };
        if (!win) return;
        if (canvas.width !== win.pixelSize.width) canvas.width = win.pixelSize.width;
        if (canvas.height !== win.pixelSize.height) canvas.height = win.pixelSize.height;
        canvas.style.left = `${win.display.x}px`;
        canvas.style.top = `${win.display.y}px`;
        canvas.style.width = `${win.display.width}px`;
        canvas.style.height = `${win.display.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        perf.resize = performance.now() - t0;
        renderScreenshot(ctx, image, doc, {
            view,
            bare,
            skipItemId: selectedId,
            overrideItem: previewItemRef.current,
            extraItem: draft,
            spotlight: spotlightDraft ?? previewSpotlightRef.current ?? undefined,
            visible: { rect: win.frameRect, scale: win.scale },
            perf,
        });
        logDrawPerf(win.pixelSize.width, win.pixelSize.height, t0, perf);
    };

    // TEMP [ScreenshotPerf]
    useEffect(() => { logPerfEnvironment(image); }, [image]);

    useEffect(() => {
        scheduleRedraw();
    }, [doc, view, frame, scale, selectedId, draft, spotlightDraft, image, scheduleRedraw]);

    // Scrolling/resizing only needs a redraw once the visible area leaves what was painted
    useEffect(() => {
        const scroller = scrollContainerRef?.current ?? null;
        const onViewportChange = () => {
            const box = boxRef.current;
            const visible = box && visibleInBox(box, scroller);
            if (!visible) return;
            const drawn = drawnRef.current;
            if (drawn && drawn.dpr === window.devicePixelRatio && rectContainsRect(drawn.display, visible)) return;
            scheduleRedraw();
        };
        const target: HTMLElement | Window = scroller ?? window;
        target.addEventListener('scroll', onViewportChange, { passive: true });
        // Window resize also catches devicePixelRatio changes (moving to another display)
        window.addEventListener('resize', onViewportChange);
        // The scroll area can resize on its own (side panels) while zoomed in
        const observer = scroller ? new ResizeObserver(onViewportChange) : null;
        if (scroller) observer?.observe(scroller);
        return () => {
            target.removeEventListener('scroll', onViewportChange);
            window.removeEventListener('resize', onViewportChange);
            observer?.disconnect();
        };
    }, [scrollContainerRef, scheduleRedraw]);

    // Clearing the handle matters: scheduleRedraw() no-ops while one is pending,
    // so a cancelled-but-kept handle would block every later frame (StrictMode
    // remounts this component, which is exactly that sequence).
    useEffect(() => () => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
    }, []);

    // ---- Zoom ----
    // ⌘/ctrl + wheel (trackpad pinch arrives as ctrl + wheel) zooms around the
    // cursor. Native listener: React registers wheel as passive, so it could
    // not preventDefault the browser's own page zoom.
    useEffect(() => {
        const scroller = scrollContainerRef?.current;
        if (!scroller) return;
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const raw = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
            const factor = Math.min(WHEEL_ZOOM_MAX_STEP, Math.max(1 / WHEEL_ZOOM_MAX_STEP, raw));
            useScreenshotUIStore.getState().zoomBy(factor, { x: e.clientX, y: e.clientY });
        };
        scroller.addEventListener('wheel', onWheel, { passive: false });
        return () => scroller.removeEventListener('wheel', onWheel);
    }, [scrollContainerRef]);

    // Keep the point under the anchor fixed: snapshot which source point sits
    // under it BEFORE React re-renders at the new scale (zustand notifies
    // synchronously on set), then correct the scroll after layout.
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const originRef = useRef(frame.origin);
    originRef.current = frame.origin;
    const zoomAnchorRef = useRef<{ client: Point; source: Point } | null>(null);
    useEffect(() => useScreenshotUIStore.subscribe((state, prev) => {
        if (state.zoom === prev.zoom) return;
        const box = boxRef.current;
        const scroller = scrollContainerRef?.current;
        if (!box || !scroller) return;
        const rect = box.getBoundingClientRect();
        const area = scroller.getBoundingClientRect();
        const client = state.zoomAnchor ?? { x: area.left + area.width / 2, y: area.top + area.height / 2 };
        const s = scaleRef.current;
        const o = originRef.current;
        zoomAnchorRef.current = {
            client,
            source: { x: (client.x - rect.left) / s + o.x, y: (client.y - rect.top) / s + o.y },
        };
    }), [scrollContainerRef]);
    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current;
        if (!anchor) return;
        zoomAnchorRef.current = null;
        const box = boxRef.current;
        const scroller = scrollContainerRef?.current;
        if (!box || !scroller) return;
        const rect = box.getBoundingClientRect();
        scroller.scrollLeft += rect.left + (anchor.source.x - frame.origin.x) * scale - anchor.client.x;
        scroller.scrollTop += rect.top + (anchor.source.y - frame.origin.y) * scale - anchor.client.y;
    }, [scale, frame.origin.x, frame.origin.y, scrollContainerRef]);

    // ---- Pointer handling ----
    const toSourcePoint = useCallback((e: React.PointerEvent): Point => {
        const rect = boxRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: (e.clientX - rect.left) / scale + frame.origin.x, y: (e.clientY - rect.top) / scale + frame.origin.y };
    }, [scale, frame.origin.x, frame.origin.y]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!doc || tool === 'crop' || e.button !== 0) return;
        const p = toSourcePoint(e);

        if (tool === 'select') {
            // Annotations paint over the spotlight, so they win the hit-test
            const hit = hitTestAnnotations(doc.annotations, p, HIT_TOLERANCE_DISPLAY_PX / scale, textScale);
            const lit = doc.spotlight && intersectRects(doc.spotlight.rectPx, view);
            select(hit ? hit.id : lit && rectContains(lit, p) ? doc.spotlight!.id : null);
            return;
        }

        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { start: clampPoint(p, view), moved: false, pointerId: e.pointerId };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || !doc) return;
        const p = clampPoint(toSourcePoint(e), view);
        if (!drag.moved) {
            const distance = Math.hypot((p.x - drag.start.x) * scale, (p.y - drag.start.y) * scale);
            if (distance < DRAG_THRESHOLD_DISPLAY_PX) return;
            drag.moved = true;
        }
        if (tool === 'spotlight') setSpotlightDraft(newSpotlight(dragRect(drag.start, p)));
        else setDraft(itemFromDrag(tool, doc, view, drag.start, p));
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || !doc) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture(drag.pointerId); } catch { /* already released */ }
        setDraft(null);
        setSpotlightDraft(null);

        const p = clampPoint(toSourcePoint(e), view);
        if (tool === 'spotlight') {
            const spotlight = newSpotlight(drag.moved ? dragRect(drag.start, p) : defaultSpotlightRect(p, view));
            setSpotlight(spotlight);
            setTool('select');
            select(spotlight.id);
            return;
        }
        const item = drag.moved
            ? itemFromDrag(tool, doc, view, drag.start, p)
            : (() => { const base = defaultItemFor(tool, doc, view); return base ? centerItemAt(base, p, view, textScale) : null; })();
        if (!item) return;

        addAnnotation(item);
        const createdTool = tool;
        setTool('select');
        select(item.id);
        if (createdTool === 'text') enterTextEdit();
    };

    const cursorClass = tool === 'select' ? 'cursor-default' : tool === 'crop' ? '' : 'cursor-crosshair';

    return (
        // Auto margins (not justify-center) so a zoomed-in box overflows to the
        // right and stays reachable by scrolling instead of clipping its left edge
        <div ref={containerRef} className="w-full flex">
            {doc && containerWidth > 0 && (
                <div
                    ref={boxRef}
                    className={`relative shrink-0 mx-auto bg-surface shadow-sm select-none touch-none ${cursorClass}`}
                    style={{ width: displayWidth, height: displayHeight }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    data-testid="screenshot-canvas"
                >
                    {/* Placed and sized by the draw — it covers only the on-screen part of the box */}
                    <canvas ref={canvasRef} className="absolute block" />
                    {/* Clip to the frame; the inner wrapper is the full source in display px */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div
                            className="absolute"
                            style={{
                                left: -frame.origin.x * scale,
                                top: -frame.origin.y * scale,
                                width: sourceSize.width * scale,
                                height: sourceSize.height * scale,
                            }}
                        >
                            {tool === 'crop'
                                ? <CropLayer mapper={mapper} sourceSize={sourceSize} />
                                : (
                                    <AnnotationLayer
                                        mapper={mapper}
                                        view={view}
                                        previewItemRef={previewItemRef}
                                        previewSpotlightRef={previewSpotlightRef}
                                    />
                                )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
