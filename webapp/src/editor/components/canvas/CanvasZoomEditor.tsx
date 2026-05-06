import React, { useRef, useEffect } from 'react';
import type { Rect } from '@shared/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';

import { BoundingBox } from './bounding-box';
import { DimmedOverlay } from '../../../components/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { type RenderResources } from '@shared/export/PlaybackRenderer';
import { drawScreen } from '@shared/painters/screenPainter';
import { drawOverlays } from '@shared/painters/overlayPainter';
import type { Project } from '@shared/types';

// Maximum zoom bounding box size as a fraction of the output
const MAX_ZOOM_RATIO = 0.9;

// ------------------------------------------------------------------
// LOGIC: Render Strategy
// ------------------------------------------------------------------
export const renderZoomEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        currentTimeMs: number,
        editingZoomId: string | null,
        previewZoomRect: Rect | null
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, editingZoomId, previewZoomRect } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = project.screenSource;

    // Force Full Viewport (Ignore current Zoom) so user can see context
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Render Screen Layer
    if (screenSource.storagePath) {
        const video = videoRefs[screenSource.storagePath];
        if (video) {
            drawScreen(
                ctx,
                video,
                project,
                effectiveViewport,
                resources.deviceFrameImg
            );
        }
    }

    // Render Overlay annotations (if any are active at this time)
    const overlaySegments = project.timeline.overlaySegments || [];
    if (overlaySegments.length > 0) {
        drawOverlays(ctx, overlaySegments, state.currentTimeMs, outputSize, effectiveViewport);
    }
};

// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------

export const ZoomEditor: React.FC<{ previewRectRef?: React.MutableRefObject<Rect | null> }> = ({ previewRectRef }) => {
    // Connect to Stores
    const editingZoomId = useUIStore(s => s.selectedZoomId);

    // Actions
    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const project = useProjectStore(s => s.project);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Derived State
    const videoSize = project.settings.outputSize;
    const maxSize = React.useMemo(() => ({
        width: videoSize.width * MAX_ZOOM_RATIO,
        height: videoSize.height * MAX_ZOOM_RATIO,
    }), [videoSize]);

    const initialRect = editingZoomId
        ? project.timeline.zoomSegments.find(m => m.id === editingZoomId)?.rectPx
        : null;

    // Actions
    const onCommit = (rect: Rect) => {
        if (!editingZoomId) return;

        batchAction(() => {
            updateZoomSegment(editingZoomId, { rectPx: rect, type: 'manual' });
        });
        endInteraction();
    };

    const onCancel = () => {
        // Just deselect. No "Cancel" of changes because they are applied live now via batcher.
        useUIStore.getState().selectZoom(null);
    };

    const onDelete = () => {
        if (editingZoomId) {
            deleteZoomSegment(editingZoomId);
            onCancel();
        }
    };

    const containerRef = useRef<HTMLDivElement>(null);


    const [currentRect, setCurrentRect] = React.useState<Rect>(initialRect || { x: 0, y: 0, width: 0, height: 0 });

    // Sync state if initialRect changes externally (e.g. undo/redo)
    useEffect(() => {
        if (initialRect) {
            setCurrentRect(initialRect);
            if (previewRectRef) previewRectRef.current = initialRect;
        }
    }, [initialRect, previewRectRef]);

    const handleRectChange = (newRect: Rect) => {
        setCurrentRect(newRect);
        if (previewRectRef) previewRectRef.current = newRect;

        // Live Update Store!
        if (editingZoomId) {
            batchAction(() => {
                updateZoomSegment(editingZoomId, { rectPx: newRect });
            });
        }
    };



    // Key Listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                onDelete();
            }
            if (e.key === 'Escape') {
                onCancel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onDelete, onCancel]); // Verify stable refs

    if (!initialRect || !editingZoomId) return null;

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-[var(--z-index-modal)] text-sm"
        >
            <DimmedOverlay
                holeRect={currentRect}
            />

            <BoundingBox
                rect={currentRect}
                maxSize={maxSize}
                fixedAspectRatio={currentRect.width / currentRect.height}
                onChange={handleRectChange}
                onCommit={onCommit}
                onDragStart={startInteraction}
            />
        </div>
    );
};
