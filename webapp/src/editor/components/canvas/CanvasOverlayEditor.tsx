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
        overrideOverlayItem?: OverlayItem | null,
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, currentTimeMs, editingItemId } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = project.screenSource;

    // Force full viewport (ignore current zoom) so user can see context
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Render screen layer
    if (screenSource.storagePath) {
        const video = videoRefs[screenSource.storagePath];
        if (video) {
            drawScreen(ctx, video, project, effectiveViewport, resources.deviceFrameImg);
        }
    }

    let overlaySegments = project.timeline.overlaySegments || [];
    if (state.overrideOverlayItem && state.editingItemId) {
        overlaySegments = overlaySegments.map(seg => 
            (seg.item.id === state.editingItemId && state.overrideOverlayItem) 
                ? { ...seg, item: state.overrideOverlayItem } 
                : seg
        );
    }
    drawOverlays(ctx, overlaySegments, currentTimeMs, outputSize, effectiveViewport, editingItemId);
};

// ------------------------------------------------------------------
// COMPONENT: Interactive HTML Overlay
// Shows bounding box / manipulation handles for the selected segment's single item.
// ------------------------------------------------------------------

export const OverlayEditor: React.FC<{ previewItemRef: React.MutableRefObject<OverlayItem | null> }> = ({ previewItemRef }) => {
    const displayMapper = useDisplayMapper();
    const project = useProjectStore(s => s.project);
    const outputSize = project.settings.outputSize;
    const selectedBlockId = useUIStore(s => s.selectedOverlaySegmentId);
    const updateOverlayItemData = useProjectStore(s => s.updateOverlayItemData);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
    const resetEditorStore = useOverlayEditorStore(s => s.reset);

    // Reset editor store when selected block changes
    useEffect(() => {
        resetEditorStore();
    }, [selectedBlockId, resetEditorStore]);

    // Find the selected block
    const block = useMemo(() =>
        (project.timeline.overlaySegments || []).find((b: OverlaySegment) => b.id === selectedBlockId),
        [project.timeline.overlaySegments, selectedBlockId]
    );

    if (!block || !displayMapper) return null;

    const item = block.item;
    const blockId = block.id;

    // Wrapper for updateOverlayItemData that matches the old (blockId, itemId, updates) signature
    // used by sub-components — simplified since there's only one item per segment
    const updateItem = (updates: Partial<OverlayItem>) => {
        updateOverlayItemData(blockId, updates);
    };

    return (
        <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
            {/* Contrasting outline for bounding box visibility on any background */}
            <style>{`
                .overlay-editor-contrast #bounding-box {
                    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
                }
            `}</style>

            {/* Selected overlay item — interactive bounding box */}
            <div className="overlay-editor-contrast">
                <OverlayItemEditor
                    item={item}
                    blockId={blockId}
                    outputSize={outputSize}
                    updateItem={updateItem}
                    startInteraction={startInteraction}
                    endInteraction={endInteraction}
                    batchAction={batchAction}
                    previewItemRef={previewItemRef}
                />
            </div>
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
    updateItem: (updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
    previewItemRef: React.MutableRefObject<OverlayItem | null>;
}

const OverlayItemEditor: React.FC<OverlayItemEditorProps> = ({
    item: storeItem, blockId, outputSize, updateItem, startInteraction, endInteraction, batchAction, previewItemRef
}) => {
    // We hold a local replica of the item to avoid modifying the global store at 60fps.
    // This allows smooth dragging without triggering a full project re-render.
    const [localItem, setLocalItem] = React.useState<OverlayItem>(storeItem);
    const isDraggingRef = React.useRef(false);

    // Sync with the store when not dragging (e.g., from undo/redo or right-panel edits)
    useEffect(() => {
        if (!isDraggingRef.current) {
            setLocalItem(storeItem);
            previewItemRef.current = null;
        }
    }, [storeItem, previewItemRef]);

    const applyLocalUpdate = React.useCallback((updates: Partial<OverlayItem>) => {
        setLocalItem(prev => {
            const next = { ...prev, ...updates } as OverlayItem;
            previewItemRef.current = next;
            return next;
        });
    }, [previewItemRef]);

    const commitUpdate = React.useCallback((updates: Partial<OverlayItem>) => {
        applyLocalUpdate(updates);
        batchAction(() => {
            updateItem(updates);
        });
        endInteraction();
        isDraggingRef.current = false;
        previewItemRef.current = null;
    }, [applyLocalUpdate, batchAction, updateItem, endInteraction, previewItemRef]);

    const handleStartDrag = React.useCallback(() => {
        isDraggingRef.current = true;
        startInteraction();
    }, [startInteraction]);

    const cancelInteraction = React.useCallback(() => {
        endInteraction();
        isDraggingRef.current = false;
        previewItemRef.current = null;
    }, [endInteraction, previewItemRef]);

    useEffect(() => {
        return () => { previewItemRef.current = null; };
    }, [previewItemRef]);

    const item = localItem; // Render UI using local interactive item

    const handleRectChange = (rect: Rect) => {
        if (item.type === 'blur' || item.type === 'border') {
            applyLocalUpdate({ rectPx: rect } as Partial<OverlayItem>);
        }
    };

    const handleRectCommit = (rect: Rect) => {
        if (item.type === 'blur' || item.type === 'border') {
            commitUpdate({ rectPx: rect } as Partial<OverlayItem>);
        }
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
                    hideCornerPreview={item.type === 'border'}
                    hideLinkToggle={item.type === 'blur'}
                    onChange={handleRectChange}
                    onCommit={handleRectCommit}
                    onDragStart={handleStartDrag}
                    allowCornerEditing
                    cornerRadii={rectItem.borderRadiusPx}
                    onCornerRadiiChange={(radii) => {
                        applyLocalUpdate({
                            borderRadiusPx: radii,
                        } as Partial<OverlayItem>);
                    }}
                    onCornerRadiiCommit={(radii) => {
                        commitUpdate({
                            borderRadiusPx: radii,
                        } as Partial<OverlayItem>);
                    }}
                />
            );
        }
        case 'text': {
            return (
                <InlineTextEditor
                    item={item as TextOverlayItem}
                    updateItem={updateItem}
                    applyLocalUpdate={applyLocalUpdate}
                    commitUpdate={commitUpdate}
                    startInteraction={handleStartDrag}
                    cancelInteraction={cancelInteraction}
                    batchAction={batchAction}
                />
            );
        }
        case 'arrow': {
            return (
                <ArrowPointHandles
                    item={item as ArrowOverlayItem}
                    applyLocalUpdate={applyLocalUpdate}
                    commitUpdate={commitUpdate}
                    startInteraction={handleStartDrag}
                    cancelInteraction={cancelInteraction}
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
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
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
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
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

// ------------------------------------------------------------------
// Inline text editor — two-mode interaction
// Selected mode: cursor=move, drag to reposition, double-click to edit
// Editing mode: cursor=text, contentEditable, Escape to exit
// ------------------------------------------------------------------

const InlineTextEditor: React.FC<{
    item: TextOverlayItem;
    updateItem: (updates: Partial<OverlayItem>) => void;
    applyLocalUpdate: (updates: Partial<OverlayItem>) => void;
    commitUpdate: (updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    cancelInteraction: () => void;
    batchAction: (fn: () => void) => void;
}> = ({ item, updateItem, applyLocalUpdate, commitUpdate, startInteraction, cancelInteraction, batchAction }) => {
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
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
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
            enterEditMode();
        }
    }, [isEditing, enterEditMode]);

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
        exitEditMode();
    }, [item, updateItem, batchAction, exitEditMode]);

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
            try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
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
