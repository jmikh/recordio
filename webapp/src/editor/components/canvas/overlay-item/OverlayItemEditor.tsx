/**
 * Per-item interactive editor: bounding box for blur/border, endpoint
 * handles for arrows, inline editor for text. Store-free — the host
 * (video `OverlayEditor`, screenshot `AnnotationLayer`) supplies the item,
 * the update function, the history batcher and the edit-mode state, and
 * a DisplayMapper via useDisplayMapper (store-derived or provided).
 */
import React, { useEffect } from 'react';
import type { Rect } from '@shared/types';
import type { OverlayItem, BlurOverlayItem, BorderOverlayItem, ArrowOverlayItem, TextOverlayItem } from '@shared/types/overlay';
import { useDisplayMapper } from '../../../hooks/useDisplayMapper';
import type { HistoryBatcher } from '../../../hooks/useHistoryBatcher';
import { BoundingBox } from '../bounding-box';
import { ArrowPointHandles } from './ArrowPointHandles';
import { InlineTextEditor } from './InlineTextEditor';

export interface OverlayItemEditorProps {
    item: OverlayItem;
    /** Commits a change to the host's store (called inside batchAction) */
    updateItem: (updates: Partial<OverlayItem>) => void;
    batcher: HistoryBatcher;
    /** The in-drag replica the host's canvas paints instead of the store item */
    previewItemRef: React.MutableRefObject<OverlayItem | null>;
    /** Multiplier for the painter's text reference metrics (padding, radius) */
    textScale: number;
    /** Keeps rect items inside this area (output coords); default: the mapper's output size */
    constraintBounds?: Rect;
    /** Text items: inline edit mode (host-owned so toolbar/keyboard can toggle it) */
    isEditing: boolean;
    onEnterEdit: () => void;
    onExitEdit: () => void;
    /** Hide the corner link/unlink toggle (corners always edit together) */
    hideLinkToggle?: boolean;
}

export const OverlayItemEditor: React.FC<OverlayItemEditorProps> = ({
    item: storeItem, updateItem, batcher, previewItemRef, textScale, constraintBounds, isEditing, onEnterEdit, onExitEdit,
    hideLinkToggle = false,
}) => {
    const { startInteraction, endInteraction, batchAction } = batcher;
    const displayMapper = useDisplayMapper();
    const outputSize = displayMapper.outputSize;

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
                    constraintBounds={constraintBounds}
                    hideCornerPreview={item.type === 'border'}
                    hideLinkToggle={hideLinkToggle || item.type === 'blur'}
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
                    textScale={textScale}
                    updateItem={updateItem}
                    applyLocalUpdate={applyLocalUpdate}
                    commitUpdate={commitUpdate}
                    startInteraction={handleStartDrag}
                    cancelInteraction={cancelInteraction}
                    batchAction={batchAction}
                    isEditing={isEditing}
                    onEnterEdit={onEnterEdit}
                    onExitEdit={onExitEdit}
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
