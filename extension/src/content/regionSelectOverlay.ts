/**
 * @fileoverview Region select overlay (plans/screenshots Step 4).
 *
 * Drag a rectangle on the page. Vanilla DOM like countdownOverlay.ts
 * (React can't run in content scripts). A fixed root at max z-index owns
 * pointer events; an SVG even-odd path dims everything but the selection;
 * a label shows the size in CSS px; the capture toast carries the hints.
 *
 * Confirm = HIDE FIRST, THEN REPORT: the root and toast are removed, then
 * we wait two animation frames (the first fires before the frame that
 * reflects the removal is composited) plus a small margin before calling
 * onSelected — captureVisibleTab must never see the overlay.
 *
 * Coordinates: rect in CSS px relative to the VISUAL viewport
 * (clientX − visualViewport.offsetLeft), plus the visual viewport size, so
 * the background can derive the crop scale from the captured bitmap
 * (bitmap.width / viewport.width) with no DPR/zoom special cases.
 */

import type { RegionSelectedPayload } from '../shared/messageTypes';
import { createCaptureToast, type CaptureToast } from './captureToast';
import { afterRepaint } from './fullPage/captureTiming';

const STYLE_ID = 'recordio-region-styles';
const MIN_SIZE_PX = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .recordio-region {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            cursor: crosshair;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .recordio-region__mask {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        }
        .recordio-region__mask path {
            fill: oklch(0 0 0 / 45%);
            fill-rule: evenodd;
        }
        .recordio-region__box {
            position: absolute;
            display: none;
            border: 1px solid oklch(0.62 0.22 290);
            box-shadow: 0 0 0 1px oklch(0 0 0 / 40%);
            pointer-events: none;
            box-sizing: border-box;
        }
        .recordio-region__label {
            position: absolute;
            display: none;
            padding: 2px 6px;
            border-radius: 4px;
            background: oklch(0.62 0.22 290);
            color: oklch(0.98 0 0);
            font-size: 11px;
            line-height: 1.4;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

interface DragRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function normalize(x0: number, y0: number, x1: number, y1: number): DragRect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx0 = Math.max(0, Math.min(vw, x0));
    const cy0 = Math.max(0, Math.min(vh, y0));
    const cx1 = Math.max(0, Math.min(vw, x1));
    const cy1 = Math.max(0, Math.min(vh, y1));
    return {
        x: Math.min(cx0, cx1),
        y: Math.min(cy0, cy1),
        width: Math.abs(cx1 - cx0),
        height: Math.abs(cy1 - cy0),
    };
}

/**
 * Show the overlay.
 * @returns a cleanup function that removes it without invoking either callback.
 */
export function showRegionSelect(
    onSelected: (selection: RegionSelectedPayload) => void,
    onCancel: () => void,
): () => void {
    injectStyles();

    const root = document.createElement('div');
    root.className = 'recordio-region';
    root.setAttribute('data-recordio', 'region-select');

    const mask = document.createElementNS(SVG_NS, 'svg');
    mask.setAttribute('class', 'recordio-region__mask');
    mask.setAttribute('aria-hidden', 'true');
    const maskPath = document.createElementNS(SVG_NS, 'path');
    mask.appendChild(maskPath);
    root.appendChild(mask);

    const box = document.createElement('div');
    box.className = 'recordio-region__box';
    root.appendChild(box);

    const label = document.createElement('div');
    label.className = 'recordio-region__label';
    root.appendChild(label);

    document.body.appendChild(root);
    const toast: CaptureToast = createCaptureToast('Drag to select an area  ·  [Enter] confirm  ·  [Esc] cancel');

    let start: { x: number; y: number } | null = null;
    let rect: DragRect | null = null;
    let removed = false;
    let done = false;

    function render() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const full = `M0 0H${vw}V${vh}H0Z`;
        if (!rect || rect.width === 0 || rect.height === 0) {
            maskPath.setAttribute('d', full);
            box.style.display = 'none';
            label.style.display = 'none';
            return;
        }
        const { x, y, width, height } = rect;
        maskPath.setAttribute('d', `${full}M${x} ${y}H${x + width}V${y + height}H${x}Z`);
        box.style.display = 'block';
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;

        label.style.display = 'block';
        label.textContent = `${Math.round(width)} × ${Math.round(height)}`;
        // Below the box when there is room, otherwise inside its bottom edge
        const labelH = 20;
        const below = y + height + 6 + labelH <= vh;
        label.style.left = `${x}px`;
        label.style.top = below ? `${y + height + 6}px` : `${Math.max(0, y + height - labelH - 6)}px`;
    }
    render();

    function cleanup() {
        if (removed) return;
        removed = true;
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerup', onPointerUp);
        root.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onResize);
        root.remove();
        toast.remove();
    }

    async function confirm() {
        if (done || !rect || rect.width < MIN_SIZE_PX || rect.height < MIN_SIZE_PX) return;
        done = true;
        const selected = rect;
        cleanup();
        await afterRepaint();
        const vv = window.visualViewport;
        onSelected({
            rect: {
                x: selected.x - (vv?.offsetLeft ?? 0),
                y: selected.y - (vv?.offsetTop ?? 0),
                width: selected.width,
                height: selected.height,
            },
            viewport: {
                width: vv?.width ?? window.innerWidth,
                height: vv?.height ?? window.innerHeight,
            },
            devicePixelRatio: window.devicePixelRatio,
            visualScale: vv?.scale ?? 1,
        });
    }

    function cancel() {
        if (done) return;
        done = true;
        cleanup();
        onCancel();
    }

    const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        start = { x: e.clientX, y: e.clientY };
        rect = normalize(start.x, start.y, e.clientX, e.clientY);
        root.setPointerCapture(e.pointerId);
        render();
    };
    const onPointerMove = (e: PointerEvent) => {
        if (!start) return;
        e.preventDefault();
        rect = normalize(start.x, start.y, e.clientX, e.clientY);
        render();
    };
    const onPointerUp = (e: PointerEvent) => {
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        rect = normalize(start.x, start.y, e.clientX, e.clientY);
        start = null;
        if (rect.width >= MIN_SIZE_PX && rect.height >= MIN_SIZE_PX) {
            void confirm();
        } else {
            // A plain click — keep waiting for a real drag
            rect = null;
            render();
        }
    };
    const onPointerCancel = () => {
        start = null;
        rect = null;
        render();
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            void confirm();
        }
    };
    const onResize = () => {
        // Geometry is stale after a resize — start over rather than crop the wrong area
        start = null;
        rect = null;
        render();
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);

    return cleanup;
}
