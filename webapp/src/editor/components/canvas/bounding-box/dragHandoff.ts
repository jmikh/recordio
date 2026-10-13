/**
 * Press-to-drag handoff.
 *
 * A canvas hover target (camera, blur region) selects its item on pointerdown,
 * which mounts that item's editor and BoundingBox. Handing the press over lets
 * the new BoundingBox continue it as a move-drag, so select + drag is a single
 * gesture instead of click, then press again.
 *
 * The pending press is dropped on pointerup/cancel, so a box that mounts after
 * the press already ended never starts a stuck drag.
 */

export interface PendingDrag {
    pointerId: number;
    clientX: number;
    clientY: number;
    shiftKey: boolean;
}

let pending: PendingDrag | null = null;

/** Called from the pointerdown that selects an item with a BoundingBox editor. */
export function beginDragHandoff(e: { pointerId: number; clientX: number; clientY: number; shiftKey: boolean }): void {
    pending = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };

    const clear = (ev: PointerEvent) => {
        if (pending?.pointerId === ev.pointerId) pending = null;
        window.removeEventListener('pointerup', clear, true);
        window.removeEventListener('pointercancel', clear, true);
    };
    window.addEventListener('pointerup', clear, true);
    window.addEventListener('pointercancel', clear, true);
}

/** Called once by a freshly mounted BoundingBox; returns the press to continue, if any. */
export function takeDragHandoff(): PendingDrag | null {
    const p = pending;
    pending = null;
    return p;
}
