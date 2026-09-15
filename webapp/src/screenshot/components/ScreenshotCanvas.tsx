/**
 * The screenshot canvas (plans/screenshots Step 8): renders the cropped
 * source + annotations at 1:1 into a <canvas> scaled to fit the container
 * width (or the view-only zoom from the UI store: ⌘/ctrl + wheel and
 * trackpad pinch zoom around the cursor, the zoom controls around the
 * centre of the scroll area), and hosts the interactive layers. Pointer handling here covers
 * selection (hit-test) and drag-to-create; moving/resizing a selected
 * item is the shared overlay-item kit's job (AnnotationLayer).
 *
 * Coordinates: annotations are uncropped source px. The layer wrapper is
 * offset by -crop × scale so a DisplayMapper over the FULL source maps
 * them straight to display px; the outer box clips to the crop.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DisplayMapper } from '@shared/mappers/displayMapper';
import type { Rect, Size } from '@shared/types';
import type { ArrowOverlayItem, BlurOverlayItem, BorderOverlayItem, OverlayItem, OverlayItemType, TextOverlayItem } from '@shared/types/overlay';
import type { ScreenshotDoc } from '@shared/types/screenshot';
import { createDefaultItemInRect } from '../../editor/overlay/defaultItems';
import { useScreenshotDoc, useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotUIStore, type ScreenshotTool } from '../store/useScreenshotUIStore';
import { renderScreenshot, supportsCanvasFilter } from '../render/renderScreenshot';
import {
    HIT_TOLERANCE_DISPLAY_PX,
    centerItemAt,
    clampPoint,
    effectiveCrop,
    fitScale,
    fullSourceRect,
    hitTestAnnotations,
    normalizeRect,
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

/** The tool's item spanning a drag from a to b. */
function itemFromDrag(tool: ScreenshotTool, doc: ScreenshotDoc, view: Rect, a: Point, b: Point): OverlayItem | null {
    const base = defaultItemFor(tool, doc, view);
    if (!base) return null;
    const r = normalizeRect(a, b);
    const rect: Rect = {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.max(MIN_ITEM_PX, Math.round(r.width)),
        height: Math.max(MIN_ITEM_PX, Math.round(r.height)),
    };
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

    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [draft, setDraft] = useState<OverlayItem | null>(null);
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
    const fit = fitScale(view, containerWidth);
    const scale = zoom ?? fit;
    useEffect(() => { setFitScale(fit); }, [fit, setFitScale]);
    const displayWidth = view.width * scale;
    const displayHeight = view.height * scale;
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

    drawRef.current = () => {
        const canvas = canvasRef.current;
        if (!canvas || !doc) return;
        const width = Math.max(1, Math.round(view.width));
        const height = Math.max(1, Math.round(view.height));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderScreenshot(ctx, image, doc, {
            view,
            skipItemId: selectedId,
            overrideItem: previewItemRef.current,
            extraItem: draft,
        });
    };

    useEffect(() => {
        scheduleRedraw();
    }, [doc, view, selectedId, draft, image, scheduleRedraw]);

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
    const viewRef = useRef(view);
    viewRef.current = view;
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
        const v = viewRef.current;
        zoomAnchorRef.current = {
            client,
            source: { x: (client.x - rect.left) / s + v.x, y: (client.y - rect.top) / s + v.y },
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
        scroller.scrollLeft += rect.left + (anchor.source.x - view.x) * scale - anchor.client.x;
        scroller.scrollTop += rect.top + (anchor.source.y - view.y) * scale - anchor.client.y;
    }, [scale, view, scrollContainerRef]);

    // ---- Pointer handling ----
    const toSourcePoint = useCallback((e: React.PointerEvent): Point => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: (e.clientX - rect.left) / scale + view.x, y: (e.clientY - rect.top) / scale + view.y };
    }, [scale, view.x, view.y]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!doc || tool === 'crop' || e.button !== 0) return;
        const p = toSourcePoint(e);

        if (tool === 'select') {
            const hit = hitTestAnnotations(doc.annotations, p, HIT_TOLERANCE_DISPLAY_PX / scale, textScale);
            select(hit ? hit.id : null);
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
        setDraft(itemFromDrag(tool, doc, view, drag.start, p));
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || !doc) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture(drag.pointerId); } catch { /* already released */ }
        setDraft(null);

        const p = clampPoint(toSourcePoint(e), view);
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
                    <canvas
                        ref={canvasRef}
                        width={Math.max(1, Math.round(view.width))}
                        height={Math.max(1, Math.round(view.height))}
                        style={{ width: displayWidth, height: displayHeight }}
                        className="block"
                    />
                    {/* Clip to the visible region; the inner wrapper is the full source in display px */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div
                            className="absolute"
                            style={{
                                left: -view.x * scale,
                                top: -view.y * scale,
                                width: sourceSize.width * scale,
                                height: sourceSize.height * scale,
                            }}
                        >
                            {tool === 'crop'
                                ? <CropLayer mapper={mapper} sourceSize={sourceSize} />
                                : <AnnotationLayer mapper={mapper} view={view} previewItemRef={previewItemRef} />}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
