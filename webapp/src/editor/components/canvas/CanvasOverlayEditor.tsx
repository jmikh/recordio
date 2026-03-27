import React, { useMemo, useEffect } from 'react';
import type { Rect } from '../../../types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useOverlayEditorStore } from './useOverlayEditorStore';

import type { RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { drawOverlays, TEXT_REF_HEIGHT, TEXT_REF_PADDING, TEXT_REF_RADIUS } from '../../../core/painters/overlayPainter';
import type { Project, Size } from '../../../types';
import type { OverlayItem, OverlaySegment, BlurOverlayItem, BorderOverlayItem, ArrowOverlayItem, TextOverlayItem } from '../../../types/overlay';
import { BoundingBox } from './bounding-box';

// ------------------------------------------------------------------
// LOGIC: Render Strategy (for OverlayEdit mode)
// Renders screen without zoom (full viewport), same as spotlight editor.
// Then draws non-editing overlay items via the painter.
// ------------------------------------------------------------------
export const renderOverlayEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        currentTimeMs: number,
        editingItemId: string | null,
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, currentTimeMs, editingItemId } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = project.screenSource;

    // Force full viewport (ignore current zoom) so user can see context
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Render screen layer
    if (screenSource.id) {
        const video = videoRefs[screenSource.id];
        if (video) {
            drawScreen(ctx, video, project, effectiveViewport, resources.deviceFrameImg);
        }
    }

    // Draw non-editing overlay items (the editing item is rendered via HTML)
    const overlaySegments = project.timeline.overlaySegments || [];
    drawOverlays(ctx, overlaySegments, currentTimeMs, outputSize, effectiveViewport, editingItemId);
};

// ------------------------------------------------------------------
// COMPONENT: Interactive HTML Overlay
// Shows bounding boxes / manipulation handles for the selected item.
// ------------------------------------------------------------------

export const OverlayEditor: React.FC = () => {
    const displayMapper = useDisplayMapper();
    const project = useProjectStore(s => s.project);
    const outputSize = project.settings.outputSize;
    const selectedBlockId = useUIStore(s => s.selectedOverlaySegmentId);
    const selectedItemId = useUIStore(s => s.selectedOverlayItemId);
    const updateOverlayItem = useProjectStore(s => s.updateOverlayItem);
    const selectOverlayItem = useUIStore(s => s.selectOverlayItem);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
    const resetEditorStore = useOverlayEditorStore(s => s.reset);
    const hoveredItemId = useOverlayEditorStore(s => s.hoveredItemId);
    const setHoveredItem = useOverlayEditorStore(s => s.setHoveredItem);

    // Reset editor store when selected item changes
    useEffect(() => {
        resetEditorStore();
    }, [selectedItemId, resetEditorStore]);

    // Find the selected block and item
    const block = useMemo(() =>
        (project.timeline.overlaySegments || []).find((b: OverlaySegment) => b.id === selectedBlockId),
        [project.timeline.overlaySegments, selectedBlockId]
    );

    const selectedItem = useMemo(() =>
        block?.items.find(i => i.id === selectedItemId) ?? null,
        [block, selectedItemId]
    );

    if (!block || !displayMapper) return null;

    return (
        <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
            {/* Contrasting outline for bounding box visibility on any background */}
            <style>{`
                .overlay-editor-contrast #bounding-box {
                    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
                }
            `}</style>

            {/* Hover targets for non-selected items */}
            {block.items
                .filter(i => i.id !== selectedItemId)
                .map(item => (
                    <OverlayHoverTarget
                        key={item.id}
                        item={item}
                        blockId={block.id}
                        isHovered={hoveredItemId === item.id}
                        onHover={(hovered) => setHoveredItem(hovered ? item.id : null)}
                        selectItem={() => selectOverlayItem(item.id)}
                        updateOverlayItem={updateOverlayItem}
                        startInteraction={startInteraction}
                        endInteraction={endInteraction}
                        batchAction={batchAction}
                    />
                ))
            }

            {/* Selected overlay item — interactive bounding box */}
            {selectedItem && (
                <div className="overlay-editor-contrast">
                    <OverlayItemEditor
                        item={selectedItem}
                        blockId={block.id}
                        outputSize={outputSize}
                        updateOverlayItem={updateOverlayItem}
                        startInteraction={startInteraction}
                        endInteraction={endInteraction}
                        batchAction={batchAction}
                    />
                </div>
            )}
        </div>
    );
};

// ------------------------------------------------------------------
// Individual item editor — renders the correct interactive element
// ------------------------------------------------------------------

interface OverlayItemEditorProps {
    item: OverlayItem;
    blockId: string;
    outputSize: Size;
    updateOverlayItem: (blockId: string, itemId: string, updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
}

const OverlayItemEditor: React.FC<OverlayItemEditorProps> = ({
    item, blockId, outputSize, updateOverlayItem, startInteraction, endInteraction, batchAction
}) => {
    const handleRectChange = (rect: Rect) => {
        batchAction(() => {
            if (item.type === 'blur' || item.type === 'border') {
                updateOverlayItem(blockId, item.id, { rectPx: rect } as Partial<OverlayItem>);
            }
        });
    };

    const handleRectCommit = (rect: Rect) => {
        if (item.type === 'blur' || item.type === 'border') {
            updateOverlayItem(blockId, item.id, { rectPx: rect } as Partial<OverlayItem>);
        }
        endInteraction();
    };

    switch (item.type) {
        case 'blur':
        case 'border': {
            const rectItem = item as BlurOverlayItem | BorderOverlayItem;
            const minDim = Math.min(outputSize.width, outputSize.height);
            return (
                <BoundingBox
                    rect={rectItem.rectPx}
                    minSize={minDim * 0.04}
                    borderColor="var(--color-secondary)"
                    hideCornerPreview={item.type === 'border'}
                    hideLinkToggle={item.type === 'blur'}
                    onChange={handleRectChange}
                    onCommit={handleRectCommit}
                    onDragStart={startInteraction}
                    allowCornerEditing
                    cornerRadii={rectItem.borderRadiusPx}
                    onCornerRadiiChange={(radii) => {
                        batchAction(() => {
                            updateOverlayItem(blockId, item.id, {
                                borderRadiusPx: radii,
                            } as Partial<OverlayItem>);
                        });
                    }}
                    onCornerRadiiCommit={(radii) => {
                        updateOverlayItem(blockId, item.id, {
                            borderRadiusPx: radii,
                        } as Partial<OverlayItem>);
                        endInteraction();
                    }}
                />
            );
        }
        case 'text': {
            return (
                <InlineTextEditor
                    item={item as TextOverlayItem}
                    blockId={blockId}
                    updateOverlayItem={updateOverlayItem}
                    startInteraction={startInteraction}
                    endInteraction={endInteraction}
                    batchAction={batchAction}
                />
            );
        }
        case 'arrow': {
            return (
                <ArrowPointHandles
                    item={item as ArrowOverlayItem}
                    blockId={blockId}
                    updateOverlayItem={updateOverlayItem}
                    startInteraction={startInteraction}
                    endInteraction={endInteraction}
                    batchAction={batchAction}
                />
            );
        }
        default:
            return null;
    }
};

// ------------------------------------------------------------------
// Arrow point handles — two draggable circles for tail and head
// ------------------------------------------------------------------

const HANDLE_SIZE = 12;

const ArrowPointHandles: React.FC<{
    item: ArrowOverlayItem;
    blockId: string;
    updateOverlayItem: (blockId: string, itemId: string, updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
}> = ({ item, blockId, updateOverlayItem, startInteraction, endInteraction, batchAction }) => {
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

        const onMove = (me: PointerEvent) => {
            const dx = (me.clientX - startX) * scale;
            const dy = (me.clientY - startY) * scale;
            const newPoint = clamp({ x: startPoint.x + dx, y: startPoint.y + dy });
            batchAction(() => {
                updateOverlayItem(blockId, item.id, { [endpoint]: newPoint } as Partial<OverlayItem>);
            });
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            endInteraction();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [item, blockId, displayMapper, updateOverlayItem, startInteraction, endInteraction, batchAction]);

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

        const onMove = (me: PointerEvent) => {
            const dx = (me.clientX - startX) * scale;
            const dy = (me.clientY - startY) * scale;
            const newTail = clamp({ x: startTail.x + dx, y: startTail.y + dy });
            const newHead = clamp({ x: startHead.x + dx, y: startHead.y + dy });
            batchAction(() => {
                updateOverlayItem(blockId, item.id, {
                    tail: newTail,
                    head: newHead,
                } as Partial<OverlayItem>);
            });
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            endInteraction();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [item, blockId, displayMapper, updateOverlayItem, startInteraction, endInteraction, batchAction]);

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

// ------------------------------------------------------------------
// Inline text editor — two-mode interaction
// Selected mode: cursor=move, drag to reposition, double-click to edit
// Editing mode: cursor=text, contentEditable, Escape to exit
// ------------------------------------------------------------------

const InlineTextEditor: React.FC<{
    item: TextOverlayItem;
    blockId: string;
    updateOverlayItem: (blockId: string, itemId: string, updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
}> = ({ item, blockId, updateOverlayItem, startInteraction, endInteraction, batchAction }) => {
    const displayMapper = useDisplayMapper();
    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const textRef = React.useRef<HTMLDivElement>(null);
    const dragRef = React.useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null);

    // Interaction mode from overlay editor store
    const interactionMode = useOverlayEditorStore(s => s.interactionMode);
    const enterEditMode = useOverlayEditorStore(s => s.enterEditMode);
    const exitEditMode = useOverlayEditorStore(s => s.exitEditMode);
    const isEditing = interactionMode === 'editing';

    // Painter-derived constants (not stored per-item)
    const outputScale = outputSize.height / TEXT_REF_HEIGHT;
    const pad = Math.round(TEXT_REF_PADDING * outputScale);
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
    const displayBgRadius = Math.round(TEXT_REF_RADIUS * outputScale) * scale;

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

        const onMove = (me: PointerEvent) => {
            if (!dragRef.current) return;
            const dx = (me.clientX - dragRef.current.startX) * outputScale;
            const dy = (me.clientY - dragRef.current.startY) * outputScale;
            const newPos = {
                x: dragRef.current.startPos.x + dx,
                y: dragRef.current.startPos.y + dy,
            };
            batchAction(() => {
                updateOverlayItem(blockId, item.id, { topLeft: newPos } as Partial<OverlayItem>);
            });
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
            dragRef.current = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            endInteraction();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [isEditing, item, blockId, displayMapper, updateOverlayItem, startInteraction, endInteraction, batchAction]);

    // Double-click to enter edit mode
    const handleDoubleClick = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isEditing) {
            enterEditMode();
        }
    }, [isEditing, enterEditMode]);

    // Commit text and exit edit mode
    const commitAndExit = React.useCallback(() => {
        const el = textRef.current;
        if (el) {
            const newText = el.textContent || '';
            if (newText !== item.text) {
                updateOverlayItem(blockId, item.id, { text: newText } as Partial<OverlayItem>);
            }
        }
        exitEditMode();
    }, [item, blockId, updateOverlayItem, exitEditMode]);

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

        const onMove = (me: PointerEvent) => {
            const dxOutput = (me.clientX - startX) * outputScale;
            if (side === 'right') {
                const newWidth = Math.max(20, startWidth + dxOutput);
                batchAction(() => {
                    updateOverlayItem(blockId, item.id, { widthPx: newWidth } as Partial<OverlayItem>);
                });
            } else {
                // Left edge: move topLeft.x and shrink width to keep right edge fixed
                const newWidth = Math.max(20, startWidth - dxOutput);
                const newLeft = startLeft + (startWidth - newWidth);
                batchAction(() => {
                    updateOverlayItem(blockId, item.id, {
                        topLeft: { x: newLeft, y: item.topLeft.y },
                        widthPx: newWidth,
                    } as Partial<OverlayItem>);
                });
            }
        };

        const onUp = () => {
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            endInteraction();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [item, blockId, displayMapper, updateOverlayItem, startInteraction, endInteraction, batchAction]);

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

// ------------------------------------------------------------------
// Hover target — for non-selected items
// Shows full BoundingBox on hover for blur/border, enabling immediate drag.
// For arrow/text, onPointerDown selects + starts drag in one gesture.
// ------------------------------------------------------------------

const OverlayHoverTarget: React.FC<{
    item: OverlayItem;
    blockId: string;
    isHovered: boolean;
    onHover: (hovered: boolean) => void;
    selectItem: () => void;
    updateOverlayItem: (blockId: string, itemId: string, updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
}> = ({ item, blockId, isHovered, onHover, selectItem, updateOverlayItem, startInteraction, endInteraction, batchAction }) => {
    const displayMapper = useDisplayMapper();
    const outputSize = useProjectStore(s => s.project.settings.outputSize);

    const hoverBorder = isHovered ? '2px solid var(--color-secondary)' : '2px solid transparent';

    switch (item.type) {
        case 'blur':
        case 'border': {
            const rectItem = item as BlurOverlayItem | BorderOverlayItem;
            const display = displayMapper.outputToDisplay(rectItem.rectPx);

            // onPointerDown: select + start move drag immediately
            const handleRectPointerDown = (e: React.PointerEvent) => {
                e.stopPropagation();
                e.preventDefault();
                selectItem();
                startInteraction();

                const el = e.currentTarget as HTMLElement;
                el.setPointerCapture(e.pointerId);
                const outputScale = displayMapper.displayToOutputLength(1);
                const startX = e.clientX;
                const startY = e.clientY;
                const startRect = { ...rectItem.rectPx };

                const onMove = (me: PointerEvent) => {
                    const dx = (me.clientX - startX) * outputScale;
                    const dy = (me.clientY - startY) * outputScale;
                    batchAction(() => {
                        updateOverlayItem(blockId, item.id, {
                            rectPx: { ...startRect, x: startRect.x + dx, y: startRect.y + dy },
                        } as Partial<OverlayItem>);
                    });
                };
                const onUp = () => {
                    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    endInteraction();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            };

            return (
                <div
                    style={{
                        position: 'absolute',
                        left: display.x,
                        top: display.y,
                        width: display.width,
                        height: display.height,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        border: hoverBorder,
                        borderRadius: 2,
                    }}
                    onMouseEnter={() => onHover(true)}
                    onMouseLeave={() => onHover(false)}
                    onPointerDown={handleRectPointerDown}
                />
            );
        }
        case 'text': {
            const textItem = item as TextOverlayItem;
            const textScale = outputSize.height / TEXT_REF_HEIGHT;
            const pad = Math.round(TEXT_REF_PADDING * textScale);
            const scale = displayMapper.outputToDisplayLength(1);
            const displayFontSize = textItem.fontSizePx * scale;
            const displayPadding = pad * scale;

            const lineHeightPx = textItem.fontSizePx * 1.2;
            const canvasEl = document.createElement('canvas');
            const tmpCtx = canvasEl.getContext('2d');
            let lineCount = 1;
            if (tmpCtx) {
                tmpCtx.font = `${textItem.fontWeight} ${textItem.fontSizePx}px ${textItem.fontFamily}, sans-serif`;
                const maxW = textItem.widthPx;
                const words = (textItem.text || '').split(' ');
                let currentLine = '';
                lineCount = 0;
                for (const word of words) {
                    const test = currentLine ? `${currentLine} ${word}` : word;
                    if (tmpCtx.measureText(test).width > maxW && currentLine) {
                        lineCount++;
                        currentLine = word;
                    } else {
                        currentLine = test;
                    }
                    if (tmpCtx.measureText(currentLine).width > maxW) {
                        let remaining = currentLine;
                        currentLine = '';
                        for (const char of remaining) {
                            const charTest = currentLine + char;
                            if (tmpCtx.measureText(charTest).width > maxW && currentLine) {
                                lineCount++;
                                currentLine = char;
                            } else {
                                currentLine = charTest;
                            }
                        }
                    }
                }
                if (currentLine) lineCount++;
                if (lineCount === 0) lineCount = 1;
            }
            const totalOutputHeight = lineCount * lineHeightPx + pad * 2;

            const bgDisplay = displayMapper.outputToDisplay({
                x: textItem.topLeft.x - pad,
                y: textItem.topLeft.y - pad,
                width: textItem.widthPx + pad * 2,
                height: totalOutputHeight,
            });

            // onPointerDown: select + start move drag immediately
            const handleTextPointerDown = (e: React.PointerEvent) => {
                e.stopPropagation();
                e.preventDefault();
                selectItem();
                startInteraction();

                const el = e.currentTarget as HTMLElement;
                el.setPointerCapture(e.pointerId);
                const outputScale = displayMapper.displayToOutputLength(1);
                const startX = e.clientX;
                const startY = e.clientY;
                const startPos = { ...textItem.topLeft };

                const onMove = (me: PointerEvent) => {
                    const dx = (me.clientX - startX) * outputScale;
                    const dy = (me.clientY - startY) * outputScale;
                    batchAction(() => {
                        updateOverlayItem(blockId, item.id, {
                            topLeft: { x: startPos.x + dx, y: startPos.y + dy },
                        } as Partial<OverlayItem>);
                    });
                };
                const onUp = () => {
                    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    endInteraction();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            };

            return (
                <div
                    style={{
                        position: 'absolute',
                        left: bgDisplay.x,
                        top: bgDisplay.y,
                        width: bgDisplay.width,
                        height: bgDisplay.height,
                        boxSizing: 'border-box',
                        padding: displayPadding > 0 ? `${displayPadding}px` : undefined,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        border: hoverBorder,
                        borderRadius: 2,
                        fontFamily: `${textItem.fontFamily}, sans-serif`,
                        fontSize: `${displayFontSize}px`,
                        fontWeight: textItem.fontWeight,
                        lineHeight: 1.2,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'transparent',
                        overflow: 'hidden',
                    }}
                    onMouseEnter={() => onHover(true)}
                    onMouseLeave={() => onHover(false)}
                    onPointerDown={handleTextPointerDown}
                >
                    {textItem.text}
                </div>
            );
        }
        case 'arrow': {
            const arrowItem = item as ArrowOverlayItem;
            const tail = displayMapper.outputToDisplay({ ...arrowItem.tail, width: 0, height: 0 });
            const head = displayMapper.outputToDisplay({ ...arrowItem.head, width: 0, height: 0 });

            // onPointerDown: select + start line drag immediately
            const handleArrowPointerDown = (e: React.PointerEvent<SVGLineElement>) => {
                e.stopPropagation();
                e.preventDefault();
                selectItem();
                startInteraction();

                const el = e.currentTarget as unknown as Element;
                el.setPointerCapture(e.pointerId);
                const scale = displayMapper.displayToOutputLength(1);
                const startX = e.clientX;
                const startY = e.clientY;
                const startTail = { ...arrowItem.tail };
                const startHead = { ...arrowItem.head };

                const clamp = (p: { x: number; y: number }) => ({
                    x: Math.max(0, Math.min(p.x, outputSize.width)),
                    y: Math.max(0, Math.min(p.y, outputSize.height)),
                });

                const onMove = (me: PointerEvent) => {
                    const dx = (me.clientX - startX) * scale;
                    const dy = (me.clientY - startY) * scale;
                    batchAction(() => {
                        updateOverlayItem(blockId, item.id, {
                            tail: clamp({ x: startTail.x + dx, y: startTail.y + dy }),
                            head: clamp({ x: startHead.x + dx, y: startHead.y + dy }),
                        } as Partial<OverlayItem>);
                    });
                };
                const onUp = () => {
                    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    endInteraction();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            };

            return (
                <svg
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        zIndex: 10,
                    }}
                >
                    {/* Thick transparent hit area */}
                    <line
                        x1={tail.x} y1={tail.y}
                        x2={head.x} y2={head.y}
                        stroke="transparent"
                        strokeWidth={12}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onMouseEnter={() => onHover(true)}
                        onMouseLeave={() => onHover(false)}
                        onPointerDown={handleArrowPointerDown}
                    />
                    {/* Visible hover line */}
                    {isHovered && (
                        <line
                            x1={tail.x} y1={tail.y}
                            x2={head.x} y2={head.y}
                            stroke="var(--color-secondary)"
                            strokeWidth={2}
                            style={{ pointerEvents: 'none' }}
                        />
                    )}
                </svg>
            );
        }
        default:
            return null;
    }
};
