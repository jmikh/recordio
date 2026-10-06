import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Rect } from '@shared/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';

import { BoundingBox, type CornerRadii } from './bounding-box';
import { DimmedOverlay } from './DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { ViewMapper } from '@shared/mappers/viewMapper';
import { getDeviceFrame } from '@shared/utils/deviceFrames';
import { getZoomBoundsForRange } from '../../utils/zoomBounds';
import { DEFAULT_SPOTLIGHT_FEATHER_PX } from '@shared/animators/spotlightAnimator';

import { type RenderResources } from '@shared/export/PlaybackRenderer';
import { drawScreen } from '@shared/painters/screenPainter';
import { drawBlurs } from '@shared/painters/blurPainter';
import type { Project } from '@shared/types';

// ------------------------------------------------------------------
// LOGIC: Render Strategy (for SpotlightEdit mode)
// ------------------------------------------------------------------
export const renderSpotlightEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        currentTimeMs: number,
        editingSpotlightId: string | null,
        previewSpotlightRect: Rect | null
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project } = state;
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

    // Note: Camera is intentionally not rendered in spotlight edit mode
    // to avoid visual clutter while editing the spotlight region

    // Render blur regions (if a blur segment is active at this time)
    if (project.settings.blur?.enabled ?? true) {
        drawBlurs(ctx, project.timeline.blurSegments || [], state.currentTimeMs, outputSize, effectiveViewport);
    }
};

// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------

export const SpotlightEditor: React.FC<{ previewRectRef?: React.MutableRefObject<Rect | null> }> = ({ previewRectRef }) => {
    const editingSpotlightId = useUIStore(s => s.selectedSpotlightId);

    // Actions
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const project = useProjectStore(s => s.project);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // ViewMapper for source <-> output coordinate conversion
    const viewMapper = useMemo(() => {
        const screenSource = project.screenSource;
        if (!screenSource.storagePath) return null;

        const deviceFrame = project.settings.screen.mode === 'device'
            ? getDeviceFrame(project.settings.screen.deviceFrameId)
            : undefined;

        return new ViewMapper(
            screenSource.size,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop,
            project.screenSource.trackableContentRect,
            project.settings.screen.toolbar.enabled,
            deviceFrame
        );
    }, [
        project.screenSource,
        project.settings.outputSize,
        project.settings.screen.padding,
        project.settings.screen.crop,
        project.settings.screen.mode,
        project.settings.screen.deviceFrameId
    ]);

    // The content rect is where the screen content appears in output coordinates
    const screenContentBounds = viewMapper?.contentRect;

    // Sync Playback to Spotlight start when selected
    useEffect(() => {
        if (!editingSpotlightId) return;

        const spotlight = project.timeline.spotlightSegments.find(s => s.id === editingSpotlightId);
        if (spotlight) {
            useUIStore.getState().setCurrentTime(spotlight.outputStartTimeMs);
        }
    }, [editingSpotlightId]);

    // Derived State
    const outputSize = project.settings.outputSize;

    const spotlight = editingSpotlightId
        ? project.timeline.spotlightSegments.find(s => s.id === editingSpotlightId)
        : null;
    const initialSourceRect = spotlight?.sourceRect || null;

    // borderRadiusPx is now stored in OUTPUT coordinates - no conversion needed
    const initialCornerRadii: CornerRadii = useMemo(
        () => spotlight?.borderRadiusPx ?? [0, 0, 0, 0],
        [spotlight?.borderRadiusPx]
    );

    // Convert source rect to output rect for editing (using viewMapper)
    const initialOutputRect = useMemo(() => {
        if (!initialSourceRect || !viewMapper) return null;
        return viewMapper.eventToOutputRect(initialSourceRect);
    }, [initialSourceRect, viewMapper]);

    // Convert output rect back to source rect for saving
    // Uses viewMapper.outputToEventRect — the exact inverse of eventToOutputRect
    const outputToSourceRect = (outputRect: Rect): Rect => {
        if (!viewMapper) return outputRect;
        return viewMapper.outputToEventRect(outputRect);
    };

    // Actions
    const onCommit = (outputRect: Rect) => {
        if (!editingSpotlightId) return;

        const sourceRect = outputToSourceRect(outputRect);
        batchAction(() => {
            updateSpotlight(editingSpotlightId, { sourceRect });
        });
        endInteraction();
    };

    const onCancel = () => {
        useUIStore.getState().selectSpotlight(null);
    };

    const onDelete = () => {
        if (editingSpotlightId) {
            deleteSpotlight(editingSpotlightId);
            onCancel();
        }
    };

    const containerRef = useRef<HTMLDivElement>(null);

    const [currentOutputRect, setCurrentOutputRect] = useState<Rect>(initialOutputRect || { x: 0, y: 0, width: 0, height: 0 });
    const [currentCornerRadii, setCurrentCornerRadii] = useState<CornerRadii>(initialCornerRadii);

    // Sync state if initialOutputRect changes externally
    useEffect(() => {
        if (initialOutputRect) {
            setCurrentOutputRect(initialOutputRect);
            if (previewRectRef) previewRectRef.current = initialOutputRect;
        }
    }, [initialOutputRect, previewRectRef]);

    useEffect(() => {
        setCurrentCornerRadii(initialCornerRadii);
    }, [initialCornerRadii]);

    const handleRectChange = (newOutputRect: Rect) => {
        setCurrentOutputRect(newOutputRect);
        if (previewRectRef) previewRectRef.current = newOutputRect;

        if (editingSpotlightId) {
            const sourceRect = outputToSourceRect(newOutputRect);
            batchAction(() => {
                updateSpotlight(editingSpotlightId, { sourceRect });
            });
        }
    };

    const handleCornerRadiiChange = (newRadii: CornerRadii) => {
        setCurrentCornerRadii(newRadii);

        if (editingSpotlightId) {
            // borderRadiusPx is now stored in OUTPUT coordinates - save directly
            batchAction(() => {
                updateSpotlight(editingSpotlightId, { borderRadiusPx: newRadii });
            });
        }
    };

    const handleCornerRadiiCommit = () => {
        endInteraction();
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
    }, [onDelete, onCancel]);

    // ── Zoom Bounds ────────────────────────────────────────────────
    // Compute intersection of all zoom viewports during this spotlight.
    // All rects here are in OUTPUT coordinates.
    const zoomEnabled = project.settings.zoom.enabled ?? true;
    const effectiveZoomSegments = zoomEnabled ? project.timeline.zoomSegments : [];
    const zoomBoundsRect = useMemo(() => {
        if (!spotlight) return null;
        return getZoomBoundsForRange(
            effectiveZoomSegments,
            spotlight.outputStartTimeMs,
            spotlight.outputEndTimeMs,
            outputSize,
            project.settings.zoom,
        );
    }, [
        spotlight?.outputStartTimeMs,
        spotlight?.outputEndTimeMs,
        effectiveZoomSegments,
        outputSize,
        project.settings.zoom,
    ]);

    // If zoom bounds are smaller than 1.2× the minimum spotlight size,
    // they're too tight to be useful — show a warning banner instead.
    const minSpotlightSize = Math.min(outputSize.width, outputSize.height) / 5;
    const zoomBoundsTooSmall = zoomBoundsRect != null && (
        zoomBoundsRect.width < minSpotlightSize * 1.2 ||
        zoomBoundsRect.height < minSpotlightSize * 1.2
    );

    if (!initialOutputRect || !editingSpotlightId || !screenContentBounds) return null;

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-[var(--z-index-modal)] text-sm"
        >
            <DimmedOverlay
                holeRect={currentOutputRect}
                cornerRadii={currentCornerRadii}
                opacity={spotlight?.dimOpacity ?? project.settings.spotlight.dimOpacity}
                featherPx={project.settings.spotlight.featherPx ?? DEFAULT_SPOTLIGHT_FEATHER_PX}
            />

            {/* Zoom Bounds: too-small warning banner */}
            {zoomBoundsTooSmall && (
                <div
                    style={{
                        position: 'absolute',
                        top: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--destructive)',
                        color: 'var(--destructive)',
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    ⚠ Spotlight may not display well — multiple zooms target different parts of the screen during this timeframe
                </div>
            )}

            <BoundingBox
                rect={currentOutputRect}
                constraintBounds={screenContentBounds}
                onChange={handleRectChange}
                onCommit={onCommit}
                onDragStart={startInteraction}
                // Corner radius editing
                allowCornerEditing={true}
                cornerRadii={currentCornerRadii}
                onCornerRadiiChange={handleCornerRadiiChange}
                onCornerRadiiCommit={handleCornerRadiiCommit}
            />


        </div>
    );
};
