/**
 * Inline text editor — two-mode interaction
 * Selected mode: cursor=move, drag to reposition, double-click to edit
 * Editing mode: cursor=text, contentEditable, Escape to exit
 *
 * Edit mode is host-owned (`isEditing` / `onEnterEdit` / `onExitEdit`);
 * `textScale` replaces the video editor's `outputSize.height /
 * TEXT_REF_HEIGHT` so screenshots can scale text metrics by width.
 */
import React, { useEffect } from 'react';
import { TEXT_REF_PADDING, TEXT_REF_RADIUS } from '@shared/painters/overlayPainter';
import type { OverlayItem, TextOverlayItem } from '@shared/types/overlay';
import { useDisplayMapper } from '../../../hooks/useDisplayMapper';

export const InlineTextEditor: React.FC<{
    item: TextOverlayItem;
    textScale: number;
    updateItem: (updates: Partial<OverlayItem>) => void;
    applyLocalUpdate: (updates: Partial<OverlayItem>) => void;
    commitUpdate: (updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    cancelInteraction: () => void;
    batchAction: (fn: () => void) => void;
    isEditing: boolean;
    onEnterEdit: () => void;
    onExitEdit: () => void;
}> = ({
    item, textScale, updateItem, applyLocalUpdate, commitUpdate, startInteraction, cancelInteraction, batchAction,
    isEditing, onEnterEdit, onExitEdit,
}) => {
    const displayMapper = useDisplayMapper();
    const textRef = React.useRef<HTMLDivElement>(null);
    const dragRef = React.useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);

    // Painter-derived constants (not stored per-item)
    const pad = Math.round(TEXT_REF_PADDING * textScale);
    const bgDisplayRect = displayMapper.outputToDisplay({
        x: item.topLeft.x - pad,
        y: item.topLeft.y - pad,
        width: item.widthPx + pad * 2,
        height: 0,
    });

    // Scale factor for font size and visual properties
    const scale = displayMapper.outputToDisplayLength(1);
    const displayFontSize = item.fontSizePx * scale;
    const displayPadding = pad * scale;
    const displayBgRadius = Math.round(TEXT_REF_RADIUS * textScale) * scale;

    // Focus and select text when entering edit mode
    useEffect(() => {
        if (isEditing && textRef.current) {
            textRef.current.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(textRef.current);
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
    }, [isEditing]);

    // Drag to move (only in selected mode)
    const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
        if (isEditing) return; // In edit mode, pointer events go to contentEditable

        e.stopPropagation();
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        startInteraction();

        const outputScale = displayMapper.displayToOutputLength(1);
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startPos: { ...item.topLeft },
        };

        let lastUpdate: Partial<OverlayItem> | null = null;

        const onMove = (me: PointerEvent) => {
            if (!dragRef.current) return;
            const dx = (me.clientX - dragRef.current.startX) * outputScale;
            const dy = (me.clientY - dragRef.current.startY) * outputScale;
            const newPos = {
                x: dragRef.current.startPos.x + dx,
                y: dragRef.current.startPos.y + dy,
            };
            lastUpdate = { topLeft: newPos } as Partial<OverlayItem>;
            applyLocalUpdate(lastUpdate);
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            dragRef.current = null;
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
    }, [isEditing, item, displayMapper, startInteraction, applyLocalUpdate, commitUpdate, cancelInteraction]);

    // Double-click to enter edit mode
    const handleDoubleClick = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isEditing) {
            onEnterEdit();
        }
    }, [isEditing, onEnterEdit]);

    // Commit text and exit edit mode
    const commitAndExit = React.useCallback(() => {
        const el = textRef.current;
        if (el) {
            const newText = el.textContent || '';
            if (newText !== item.text) {
                batchAction(() => {
                    updateItem({ text: newText } as Partial<OverlayItem>);
                });
            }
        }
        onExitEdit();
    }, [item, updateItem, batchAction, onExitEdit]);

    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        left: bgDisplayRect.x,
        top: bgDisplayRect.y,
        pointerEvents: 'auto',
        cursor: isEditing ? 'text' : 'move',
        zIndex: 20,
        border: isEditing
            ? '2px solid rgba(59, 130, 246, 0.8)'
            : '2px solid var(--color-secondary)',
        borderRadius: 2,
    };

    const displayWidth = bgDisplayRect.width;

    const textStyle: React.CSSProperties = {
        // border-box: width = total bg width (content + padding), matching canvas bg rect
        boxSizing: 'border-box',
        fontFamily: `${item.fontFamily}, sans-serif`,
        fontSize: `${displayFontSize}px`,
        fontWeight: item.fontWeight,
        color: item.color,
        lineHeight: 1.2,
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        width: `${displayWidth}px`,
        outline: 'none',
        cursor: isEditing ? 'text' : 'move',
        userSelect: isEditing ? 'text' : 'none',
        padding: displayPadding > 0 ? `${displayPadding}px` : undefined,
        backgroundColor: item.backgroundColor || undefined,
        borderRadius: displayBgRadius > 0 ? `${displayBgRadius}px` : undefined,

    };

    // Drag left/right edges to resize width
    const handleEdgeDrag = React.useCallback((
        side: 'left' | 'right',
        e: React.PointerEvent
    ) => {
        e.stopPropagation();
        e.preventDefault();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        startInteraction();

        const outputScale = displayMapper.displayToOutputLength(1);
        const startX = e.clientX;
        const startWidth = item.widthPx;
        const startLeft = item.topLeft.x;

        let lastUpdate: Partial<OverlayItem> | null = null;

        const onMove = (me: PointerEvent) => {
            const dxOutput = (me.clientX - startX) * outputScale;
            if (side === 'right') {
                const newWidth = Math.max(20, startWidth + dxOutput);
                lastUpdate = { widthPx: newWidth } as Partial<OverlayItem>;
                applyLocalUpdate(lastUpdate);
            } else {
                // Left edge: move topLeft.x and shrink width to keep right edge fixed
                const newWidth = Math.max(20, startWidth - dxOutput);
                const newLeft = startLeft + (startWidth - newWidth);
                lastUpdate = {
                    topLeft: { x: newLeft, y: item.topLeft.y },
                    widthPx: newWidth,
                } as Partial<OverlayItem>;
                applyLocalUpdate(lastUpdate);
            }
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

    const HANDLE_W = 5;
    const HANDLE_H = 19;
    const edgeHandleStyle = (side: 'left' | 'right'): React.CSSProperties => ({
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        width: HANDLE_W,
        height: HANDLE_H,
        [side]: -(HANDLE_W / 2 + 2),  // center on the border edge
        cursor: 'ew-resize',
        pointerEvents: 'auto',
        zIndex: 22,
        backgroundColor: '#fff',
        borderRadius: HANDLE_W / 2,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.25)',
    });

    return (
        <div
            style={containerStyle}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
        >
            <div
                ref={textRef}
                contentEditable={isEditing}
                suppressContentEditableWarning
                style={textStyle}
                onBlur={isEditing ? commitAndExit : undefined}
                onKeyDown={(e) => {
                    if (!isEditing) return;
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        commitAndExit();
                        return;
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commitAndExit();
                        return;
                    }
                    // Prevent keys from propagating to timeline
                    e.stopPropagation();
                }}
            >
                {item.text}
            </div>
            {/* Left/right edge handles for width resizing */}
            <div
                style={edgeHandleStyle('left')}
                onPointerDown={(e) => handleEdgeDrag('left', e)}
            />
            <div
                style={edgeHandleStyle('right')}
                onPointerDown={(e) => handleEdgeDrag('right', e)}
            />
        </div>
    );
};
