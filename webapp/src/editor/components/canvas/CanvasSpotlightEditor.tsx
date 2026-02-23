import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Rect } from '../../../types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';

import { BoundingBox, type CornerRadii } from './bounding-box';
import { DimmedOverlay } from '../../../components/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';

import { ViewMapper } from '../../../core/mappers/viewMapper';
import { getDeviceFrame } from '../../../core/deviceFrames';
import { getZoomBoundsForRange } from '../../../core/zoom/zoomBounds';

import { type RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import type { Project } from '../../../types';

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
    if (screenSource.id) {
        const video = videoRefs[screenSource.id];
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

    // Display Mapper for output -> CSS coordinate conversion
    const displayMapper = useDisplayMapper();

    // ViewMapper for source <-> output coordinate conversion
    const viewMapper = useMemo(() => {
        const screenSource = project.screenSource;
        if (!screenSource.id) return null;

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
    const outputToSourceRect = (outputRect: Rect): Rect => {
        if (!viewMapper || !screenContentBounds) return outputRect;

        // Calculate the inverse mapping: output -> source
        const screenSource = project.screenSource;
        if (!screenSource.id) return outputRect;

        const effectiveInputSize = project.settings.screen.crop
            ? { width: project.settings.screen.crop.width, height: project.settings.screen.crop.height }
            : screenSource.size;
        const offsetX = project.settings.screen.crop?.x || 0;
        const offsetY = project.settings.screen.crop?.y || 0;

        // Map output rect to source coordinates
        const nx = (outputRect.x - screenContentBounds.x) / screenContentBounds.width;
        const ny = (outputRect.y - screenContentBounds.y) / screenContentBounds.height;
        const nw = outputRect.width / screenContentBounds.width;
        const nh = outputRect.height / screenContentBounds.height;

        return {
            x: nx * effectiveInputSize.width + offsetX,
            y: ny * effectiveInputSize.height + offsetY,
            width: nw * effectiveInputSize.width,
            height: nh * effectiveInputSize.height
        };
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

    // Compute the enlarged preview rect (centered on the current spotlight rect)
    const scale = spotlight?.scale ?? 1;
    const showEnlargedPreview = scale > 1;
    const scaledOutputRect = useMemo(() => {
        if (!showEnlargedPreview) return null;
        const cx = currentOutputRect.x + currentOutputRect.width / 2;
        const cy = currentOutputRect.y + currentOutputRect.height / 2;
        const sw = currentOutputRect.width * scale;
        const sh = currentOutputRect.height * scale;
        return {
            x: cx - sw / 2,
            y: cy - sh / 2,
            width: sw,
            height: sh,
        };
    }, [currentOutputRect, scale, showEnlargedPreview]);

    // ── Zoom Bounds ────────────────────────────────────────────────
    // Compute intersection of all zoom viewports during this spotlight.
    // All rects here are in OUTPUT coordinates.
    const zoomBoundsRect = useMemo(() => {
        if (!spotlight) return null;
        return getZoomBoundsForRange(
            project.timeline.zoomSegments,
            spotlight.outputStartTimeMs,
            spotlight.outputEndTimeMs,
            outputSize,
            project.settings.zoom,
        );
    }, [
        spotlight?.outputStartTimeMs,
        spotlight?.outputEndTimeMs,
        project.timeline.zoomSegments,
        outputSize,
        project.settings.zoom,
    ]);

    // Check if the spotlight (or its enlarged version) exceeds the zoom bounds
    const isOutOfBounds = useMemo(() => {
        if (!zoomBoundsRect) return false;
        const check = scaledOutputRect ?? currentOutputRect;
        return (
            check.x < zoomBoundsRect.x - 1 ||
            check.y < zoomBoundsRect.y - 1 ||
            check.x + check.width > zoomBoundsRect.x + zoomBoundsRect.width + 1 ||
            check.y + check.height > zoomBoundsRect.y + zoomBoundsRect.height + 1
        );
    }, [zoomBoundsRect, scaledOutputRect, currentOutputRect]);

    // Check if the enlarged spotlight exceeds the full output area
    // (relevant when there's no zoom, so no zoom bounds rect is shown)
    const exceedsOutputArea = useMemo(() => {
        if (!scaledOutputRect) return false;
        return (
            scaledOutputRect.x < -1 ||
            scaledOutputRect.y < -1 ||
            scaledOutputRect.x + scaledOutputRect.width > outputSize.width + 1 ||
            scaledOutputRect.y + scaledOutputRect.height > outputSize.height + 1
        );
    }, [scaledOutputRect, outputSize]);

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
                opacity={spotlight?.dimOpacity}
            />

            {/* Enlarged preview outline — non-editable, white dashed */}
            {showEnlargedPreview && scaledOutputRect && (() => {
                const displayRect = displayMapper.outputToDisplay(scaledOutputRect);
                const scaledRadii: [number, number, number, number] = [
                    currentCornerRadii[0] * scale,
                    currentCornerRadii[1] * scale,
                    currentCornerRadii[2] * scale,
                    currentCornerRadii[3] * scale,
                ];
                const displayRadii = displayMapper.outputToDisplayRadii(scaledRadii);
                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: displayRect.x,
                            top: displayRect.y,
                            width: displayRect.width,
                            height: displayRect.height,
                            border: '1px solid white',
                            borderRadius: `${displayRadii[0]}px ${displayRadii[1]}px ${displayRadii[2]}px ${displayRadii[3]}px`,
                            pointerEvents: 'none',
                            boxSizing: 'border-box',
                        }}
                    >
                        <span
                            style={{
                                position: 'absolute',
                                top: -22,
                                left: 0,
                                fontSize: 11,
                                lineHeight: '18px',
                                padding: '0 4px',
                                borderRadius: 3,
                                background: 'var(--surface-overlay)',
                                color: 'var(--color-text-main)',
                                whiteSpace: 'nowrap',
                                fontWeight: 500,
                                userSelect: 'none',
                            }}
                        >
                            When Enlarged
                        </span>
                    </div>
                );
            })()}

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
                        background: 'var(--surface-overlay)',
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

            {/* Out-of-bounds warning banner */}
            {isOutOfBounds && !zoomBoundsTooSmall && (
                <div
                    style={{
                        position: 'absolute',
                        top: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: 'var(--surface-overlay)',
                        border: '1px solid var(--destructive)',
                        color: 'var(--destructive)',
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    ⚠ Spotlight exceeds zoom area
                </div>
            )}

            {/* Output-area overflow warning (when no zoom bounds) */}
            {!zoomBoundsRect && exceedsOutputArea && (
                <div
                    style={{
                        position: 'absolute',
                        top: 8,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: 'var(--surface-overlay)',
                        border: '1px solid var(--destructive)',
                        color: 'var(--destructive)',
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    ⚠ Spotlight will exceed video boundaries when enlarged
                </div>
            )}

            {/* Zoom Bounds indicator — dashed rect in output coords → CSS */}
            {zoomBoundsRect && !zoomBoundsTooSmall && (() => {
                const displayRect = displayMapper.outputToDisplay(zoomBoundsRect);
                const boundsColor = isOutOfBounds ? 'var(--color-destructive)' : 'white';
                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: displayRect.x,
                            top: displayRect.y,
                            width: displayRect.width,
                            height: displayRect.height,
                            border: `1px dashed ${boundsColor}`,
                            pointerEvents: 'none',
                            boxSizing: 'border-box',
                        }}
                    >
                        {/* Label */}
                        <span
                            style={{
                                position: 'absolute',
                                top: -22,
                                left: 0,
                                fontSize: 11,
                                lineHeight: '18px',
                                padding: '0 4px',
                                borderRadius: 3,
                                background: 'var(--surface-overlay)',
                                color: 'var(--color-text-main)',
                                whiteSpace: 'nowrap',
                                fontWeight: 500,
                                userSelect: 'none',
                            }}
                            title="Spotlights will be clipped or video zoomed here"
                        >
                            Zoom Area
                        </span>
                    </div>
                );
            })()}

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
