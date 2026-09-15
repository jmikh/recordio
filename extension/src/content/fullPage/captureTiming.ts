/**
 * @fileoverview Paint-timing helpers for capture flows (region select, full page).
 *
 * captureVisibleTab sees whatever the compositor last produced, so anything
 * we hide or remove needs two animation frames (the first fires before the
 * frame that reflects the change is composited) plus a small margin.
 */

export function raf(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Two frames, then an optional pause — lets scroll-driven work (lazy loaders, sticky logic) run. */
export async function settle(ms: number): Promise<void> {
    await raf();
    await raf();
    if (ms > 0) await sleep(ms);
}

/** Two frames + a margin — enough for a removal/hide to be composited before a capture. */
export function afterRepaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
}
