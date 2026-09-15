/**
 * Arrow point handles — two draggable circles for tail and head, plus a
 * transparent hit line that drags the whole arrow. Coordinates come from
 * useDisplayMapper (store-derived in the video editor, provided in the
 * screenshot editor).
 */
import React from 'react';
import type { OverlayItem, ArrowOverlayItem } from '@shared/types/overlay';
import { useDisplayMapper } from '../../../hooks/useDisplayMapper';

const HANDLE_SIZE = 12;

export const ArrowPointHandles: React.FC<{
    item: ArrowOverlayItem;
    applyLocalUpdate: (updates: Partial<OverlayItem>) => void;
    commitUpdate: (updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    cancelInteraction: () => void;
}> = ({ item, applyLocalUpdate, commitUpdate, startInteraction, cancelInteraction }) => {
    const displayMapper = useDisplayMapper();
    const outputSize = displayMapper.outputSize;

    const clamp = (p: { x: number; y: number }) => ({
        x: Math.max(0, Math.min(p.x, outputSize.width)),
        y: Math.max(0, Math.min(p.y, outputSize.height)),
    });

    const handleDrag = React.useCallback((
        endpoint: 'tail' | 'head',
        e: React.PointerEvent
    ) => {
        e.stopPropagation();
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        startInteraction();

        const scale = displayMapper.displayToOutputLength(1);
        const startX = e.clientX;
        const startY = e.clientY;
        const startPoint = endpoint === 'tail' ? { ...item.tail } : { ...item.head };

        let lastUpdate: Partial<OverlayItem> | null = null;

        const onMove = (me: PointerEvent) => {
            const dx = (me.clientX - startX) * scale;
            const dy = (me.clientY - startY) * scale;
            const newPoint = clamp({ x: startPoint.x + dx, y: startPoint.y + dy });
            lastUpdate = { [endpoint]: newPoint } as Partial<OverlayItem>;
            applyLocalUpdate(lastUpdate);
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (lastUpdate) {
                commitUpdate(lastUpdate);
            } else {
                cancelInteraction(); // user just clicked
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [item, displayMapper, startInteraction, applyLocalUpdate, commitUpdate, cancelInteraction]);

    // Drag entire arrow (both tail and head move together)
    const handleLineDrag = React.useCallback((e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const el = e.currentTarget as unknown as Element;
        el.setPointerCapture(e.pointerId);
        startInteraction();

        const scale = displayMapper.displayToOutputLength(1);
        const startX = e.clientX;
        const startY = e.clientY;
        const startTail = { ...item.tail };
        const startHead = { ...item.head };

        let lastUpdate: Partial<OverlayItem> | null = null;

        const onMove = (me: PointerEvent) => {
            const dx = (me.clientX - startX) * scale;
            const dy = (me.clientY - startY) * scale;
            const newTail = clamp({ x: startTail.x + dx, y: startTail.y + dy });
            const newHead = clamp({ x: startHead.x + dx, y: startHead.y + dy });
            lastUpdate = {
                tail: newTail,
                head: newHead,
            } as Partial<OverlayItem>;
            applyLocalUpdate(lastUpdate);
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (lastUpdate) {
                commitUpdate(lastUpdate);
            } else {
                cancelInteraction();
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [item, displayMapper, startInteraction, applyLocalUpdate, commitUpdate, cancelInteraction]);

    const tailDisplay = displayMapper.outputToDisplay({ ...item.tail, width: 0, height: 0 });
    const headDisplay = displayMapper.outputToDisplay({ ...item.head, width: 0, height: 0 });

    const pointStyle = (displayPt: { x: number; y: number }): React.CSSProperties => ({
        position: 'absolute',
        left: displayPt.x - HANDLE_SIZE / 2,
        top: displayPt.y - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        border: '2px solid rgba(0, 0, 0, 0.5)',
        cursor: 'grab',
        pointerEvents: 'auto',
        zIndex: 21,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    });

    return (
        <>
            {/* Draggable line — moves entire arrow */}
            <svg
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 20,
                }}
            >
                <line
                    x1={tailDisplay.x}
                    y1={tailDisplay.y}
                    x2={headDisplay.x}
                    y2={headDisplay.y}
                    stroke="transparent"
                    strokeWidth={10}
                    style={{ pointerEvents: 'stroke', cursor: 'move' }}
                    onPointerDown={handleLineDrag}
                />
            </svg>
            {/* Endpoint handles */}
            <div
                style={pointStyle(tailDisplay)}
                onPointerDown={(e) => handleDrag('tail', e)}
                title="Arrow tail"
            />
            <div
                style={pointStyle(headDisplay)}
                onPointerDown={(e) => handleDrag('head', e)}
                title="Arrow head"
            />
        </>
    );
};
