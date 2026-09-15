import React, { useMemo, useEffect } from 'react';
import type { Rect } from '@shared/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useOverlayEditorStore } from './useOverlayEditorStore';

import type { RenderResources } from '@shared/export/PlaybackRenderer';
import { drawScreen } from '@shared/painters/screenPainter';
import { drawOverlays, TEXT_REF_HEIGHT } from '@shared/painters/overlayPainter';
import type { Project } from '@shared/types';
import type { OverlayItem, OverlaySegment } from '@shared/types/overlay';
import { OverlayItemEditor } from './overlay-item';

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
// Thin video wrapper over the store-free OverlayItemEditor (./overlay-item),
// which the screenshot editor reuses (plans/screenshots).
// ------------------------------------------------------------------

export const OverlayEditor: React.FC<{ previewItemRef: React.MutableRefObject<OverlayItem | null> }> = ({ previewItemRef }) => {
    const displayMapper = useDisplayMapper();
    const project = useProjectStore(s => s.project);
    const outputSize = project.settings.outputSize;
    const selectedBlockId = useUIStore(s => s.selectedOverlaySegmentId);
    const updateOverlayItemData = useProjectStore(s => s.updateOverlayItemData);
    const batcher = useHistoryBatcher();
    const resetEditorStore = useOverlayEditorStore(s => s.reset);
    const interactionMode = useOverlayEditorStore(s => s.interactionMode);
    const enterEditMode = useOverlayEditorStore(s => s.enterEditMode);
    const exitEditMode = useOverlayEditorStore(s => s.exitEditMode);

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
                    updateItem={updateItem}
                    batcher={batcher}
                    previewItemRef={previewItemRef}
                    textScale={outputSize.height / TEXT_REF_HEIGHT}
                    isEditing={interactionMode === 'editing'}
                    onEnterEdit={enterEditMode}
                    onExitEdit={exitEditMode}
                />
            </div>
        </div>
    );
};
