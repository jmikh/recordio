import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Rect } from '../../../core/types';
import { useProjectStore, useProjectSources } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';

import { BoundingBox } from './BoundingBox';
import { DimmedOverlay } from '../../../components/ui/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { SecondaryButton } from '../../../components/ui/SecondaryButton';
import { ViewMapper } from '../../../core/viewMapper';

import { type RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import type { ProjectState } from '../../stores/useProjectStore';
import type { Project } from '../../../core/types';

// ------------------------------------------------------------------
// LOGIC: Render Strategy (for SpotlightEdit mode)
// ------------------------------------------------------------------
export const renderSpotlightEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        sources: ProjectState['sources'],
        currentTimeMs: number,
        editingSpotlightId: string | null,
        previewSpotlightRect: Rect | null
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, sources } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = sources[project.timeline.screenSourceId];

    // Force Full Viewport (Ignore current Zoom) so user can see context
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Render Screen Layer
    if (screenSource) {
        const video = videoRefs[screenSource.id];
        if (video) {
            drawScreen(
                ctx,
                video,
                project,
                sources,
                effectiveViewport,
                resources.deviceFrameImg
            );
        }
    }

    // Render Camera Layer
    const cameraSettings = project.settings.camera;
    const cameraSourceId = project.timeline.cameraSourceId;
    const cameraSource = cameraSourceId ? sources[cameraSourceId] : undefined;

    if (cameraSource && cameraSettings) {
        const video = videoRefs[cameraSource.id];
        if (video) {
            drawWebcam(ctx, video, cameraSource.size, cameraSettings);
        }
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
    const sources = useProjectSources();

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // ViewMapper for source <-> output coordinate conversion
    const viewMapper = useMemo(() => {
        const screenSource = sources[project.timeline.screenSourceId];
        if (!screenSource) return null;

        return new ViewMapper(
            screenSource.size,
            project.settings.outputSize,
            project.settings.screen.padding,
            project.settings.screen.crop
        );
    }, [
        project.timeline.screenSourceId,
        project.settings.outputSize,
        project.settings.screen.padding,
        project.settings.screen.crop,
        sources
    ]);

    // The content rect is where the screen content appears in output coordinates
    const screenContentBounds = viewMapper?.contentRect;

    // Sync Playback to Spotlight midpoint
    useEffect(() => {
        if (!editingSpotlightId) return;

        const spotlight = project.timeline.spotlightActions.find(s => s.id === editingSpotlightId);
        if (spotlight) {
            const midTime = (spotlight.outputStartTimeMs + spotlight.outputEndTimeMs) / 2;
            useUIStore.getState().setCurrentTime(midTime);
        }
    }, [editingSpotlightId]);

    // Derived State
    const outputSize = project.settings.outputSize;

    const spotlight = editingSpotlightId
        ? project.timeline.spotlightActions.find(s => s.id === editingSpotlightId)
        : null;
    const initialSourceRect = spotlight?.sourceRect || null;

    // For the slider, use the max corner radius (all corners shown as one value)
    const initialBorderRadius = spotlight?.borderRadius
        ? Math.max(...spotlight.borderRadius)
        : 0;

    // Convert source rect to output rect for editing (using viewMapper)
    const initialOutputRect = useMemo(() => {
        if (!initialSourceRect || !viewMapper) return null;
        return viewMapper.inputToOutputRect(initialSourceRect);
    }, [initialSourceRect, viewMapper]);

    // Convert output rect back to source rect for saving
    const outputToSourceRect = (outputRect: Rect): Rect => {
        if (!viewMapper || !screenContentBounds) return outputRect;

        // Calculate the inverse mapping: output -> source
        const screenSource = sources[project.timeline.screenSourceId];
        if (!screenSource) return outputRect;

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
    };

    const onCancel = () => {
        useUIStore.getState().setCanvasMode(CanvasMode.Preview);
    };

    const onDelete = () => {
        if (editingSpotlightId) {
            deleteSpotlight(editingSpotlightId);
            onCancel();
        }
    };

    const containerRef = useRef<HTMLDivElement>(null);

    const [currentOutputRect, setCurrentOutputRect] = useState<Rect>(initialOutputRect || { x: 0, y: 0, width: 0, height: 0 });
    const [currentBorderRadius, setCurrentBorderRadius] = useState<number>(initialBorderRadius);

    // Sync state if initialOutputRect changes externally
    useEffect(() => {
        if (initialOutputRect) {
            setCurrentOutputRect(initialOutputRect);
            if (previewRectRef) previewRectRef.current = initialOutputRect;
        }
    }, [initialOutputRect, previewRectRef]);

    useEffect(() => {
        setCurrentBorderRadius(initialBorderRadius);
    }, [initialBorderRadius]);

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

    const handleRadiusChange = (newRadius: number) => {
        setCurrentBorderRadius(newRadius);

        if (editingSpotlightId) {
            // Apply the same radius to all 4 corners
            const borderRadius: [number, number, number, number] = [newRadius, newRadius, newRadius, newRadius];
            batchAction(() => {
                updateSpotlight(editingSpotlightId, { borderRadius });
            });
        }
    };

    // Batch history during the entire editing session
    useEffect(() => {
        if (editingSpotlightId) {
            startInteraction();
            return () => endInteraction();
        }
    }, [editingSpotlightId, startInteraction, endInteraction]);

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

    // Close when clicking outside
    useEffect(() => {
        const handleGlobalPointerDown = (e: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onCancel();
            }
        };
        window.addEventListener('pointerdown', handleGlobalPointerDown);
        return () => window.removeEventListener('pointerdown', handleGlobalPointerDown);
    }, [onCancel]);

    // Click on background moves the spotlight box (in output coordinates)
    const handleContainerPointerDown = (e: React.PointerEvent) => {
        if (e.target !== containerRef.current || !initialOutputRect || !screenContentBounds) return;

        const rect = containerRef.current.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        // Convert click to output coordinates
        const targetX = (offsetX / rect.width) * outputSize.width;
        const targetY = (offsetY / rect.height) * outputSize.height;

        // Use screen content bounds for clamping
        const minX = screenContentBounds.x;
        const minY = screenContentBounds.y;
        const maxX = screenContentBounds.x + screenContentBounds.width;
        const maxY = screenContentBounds.y + screenContentBounds.height;

        let newX = targetX - initialOutputRect.width / 2;
        let newY = targetY - initialOutputRect.height / 2;

        // Clamp to screen content bounds
        if (newX < minX) newX = minX;
        if (newX + initialOutputRect.width > maxX) newX = maxX - initialOutputRect.width;
        if (newY < minY) newY = minY;
        if (newY + initialOutputRect.height > maxY) newY = maxY - initialOutputRect.height;

        const newOutputRect = { ...initialOutputRect, x: newX, y: newY };
        handleRectChange(newOutputRect);
    };

    if (!initialOutputRect || !editingSpotlightId || !screenContentBounds) return null;

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-50 text-sm"
            onPointerDown={handleContainerPointerDown}
        >
            <DimmedOverlay
                holeRect={currentOutputRect}
                containerSize={outputSize}
                borderRadiusPercent={currentBorderRadius}
            />

            <BoundingBox
                rect={currentOutputRect}
                canvasSize={outputSize}
                constraintBounds={screenContentBounds}
                borderRadiusPercent={currentBorderRadius}
                maintainAspectRatio={false}
                onChange={handleRectChange}
                onCommit={onCommit}
            />

            {/* Toolbar with Radius Slider */}
            <div
                className="absolute top-4 inset-x-0 flex justify-center items-center gap-4 pointer-events-auto z-[1000]"
            >
                {/* Radius Slider */}
                <div className="flex items-center gap-2 bg-surface-overlay/90 px-3 py-1.5 rounded shadow">
                    <span className="text-xs text-text-muted">Radius</span>
                    <input
                        type="range"
                        min={0}
                        max={50}
                        value={currentBorderRadius}
                        onChange={(e) => handleRadiusChange(Number(e.target.value))}
                        className="w-20 accent-amber-400"
                    />
                    <span className="text-xs text-text-muted w-8">{currentBorderRadius}%</span>
                </div>

                {/* Delete Button */}
                <SecondaryButton
                    className="text-xs shadow"
                    onClick={(e) => {
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                        onDelete();
                    }}
                >
                    Delete
                </SecondaryButton>
            </div>
        </div>
    );
};
