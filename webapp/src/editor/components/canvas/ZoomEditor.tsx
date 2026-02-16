import React, { useRef, useEffect } from 'react';
import type { Rect } from '../../../types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useTimeMapper } from '../../hooks/useTimeMapper';

import { BoundingBox } from './bounding-box';
import { DimmedOverlay } from '../../../components/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { SecondaryButton } from '@shared/components';

import { type RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import type { Project } from '../../../types';

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

    // Render Camera Layer (Relative to Zoom)
    // 1. Get Camera Source and Settings
    const cameraSettings = project.settings.camera;
    const cameraSource = project.cameraSource;

    // Only render if we have a camera source and it's enabled
    if (cameraSource && cameraSettings) {
        const video = videoRefs[cameraSource.id];
        if (video) {
            // 2. Determine Zoom Rect (Preview or Committed)
            let zoomRect = previewZoomRect;
            if (!zoomRect && editingZoomId) {
                const action = project.timeline.zoomActions.find(m => m.id === editingZoomId);
                zoomRect = action?.rectPx || null;
            }

            if (zoomRect) {
                // 3. Calculate Relative Position
                // The camera is defined in absolute canvas coordinates (0..outputWidth, 0..outputHeight).
                // We want to project it into the zoomRect.
                //
                // Scale Factor = ZoomRect Width / Output Width

                const scaleFactor = zoomRect.width / outputSize.width;

                const relativeX = (cameraSettings.xPx / outputSize.width) * zoomRect.width;
                const relativeY = (cameraSettings.yPx / outputSize.height) * zoomRect.height;

                const projectedX = zoomRect.x + relativeX;
                const projectedY = zoomRect.y + relativeY;
                const projectedW = cameraSettings.widthPx * scaleFactor;
                const projectedH = cameraSettings.heightPx * scaleFactor;

                // 4. Draw Camera
                drawWebcam(
                    ctx,
                    video,
                    cameraSource.size, // Input size
                    {
                        ...cameraSettings,
                        xPx: projectedX,
                        yPx: projectedY,
                        widthPx: projectedW,
                        heightPx: projectedH,
                    },
                    scaleFactor // Global scale for borders/shadows
                );
            }
        }
    }
};

// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------

export const ZoomEditor: React.FC<{ previewRectRef?: React.MutableRefObject<Rect | null> }> = ({ previewRectRef }) => {
    // Connect to Stores
    const editingZoomId = useUIStore(s => s.selectedZoomId);
    const timeMapper = useTimeMapper();

    // Actions
    const updateZoomAction = useProjectStore(s => s.updateZoomAction);
    const deleteZoomAction = useProjectStore(s => s.deleteZoomAction);
    const project = useProjectStore(s => s.project);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Sync Playback to Zoom End Time
    useEffect(() => {
        if (!editingZoomId) return;

        const action = project.timeline.zoomActions.find(m => m.id === editingZoomId);
        if (action) {
            // Convert source time to output time
            const outputTime = timeMapper.mapSourceToOutputTime(action.sourceEndTimeMs);
            if (outputTime !== -1) {
                useUIStore.getState().setCurrentTime(outputTime);
            }
        }
    }, [editingZoomId, timeMapper, project.timeline.zoomActions]);

    // Derived State
    const videoSize = project.settings.outputSize;
    const initialRect = editingZoomId
        ? project.timeline.zoomActions.find(m => m.id === editingZoomId)?.rectPx
        : null;

    // Actions
    const onCommit = (rect: Rect) => {
        if (!editingZoomId) return;

        batchAction(() => {
            updateZoomAction(editingZoomId, { rectPx: rect, type: 'manual' });
        });
    };

    const onCancel = () => {
        // Just deselect. No "Cancel" of changes because they are applied live now via batcher.
        useUIStore.getState().setCanvasMode(CanvasMode.Preview);
    };

    const onDelete = () => {
        if (editingZoomId) {
            deleteZoomAction(editingZoomId);
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
                updateZoomAction(editingZoomId, { rectPx: newRect });
            });
        }
    };

    // Batch history during the entire editing session
    useEffect(() => {
        if (editingZoomId) {
            startInteraction();
            return () => endInteraction();
        }
    }, [editingZoomId, startInteraction, endInteraction]);

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
                fixedAspectRatio={currentRect.width / currentRect.height}
                onChange={handleRectChange}
                onCommit={onCommit}
            />

            {/* Toolbar - Render after BoundingBox to ensure it's on top */}
            <div
                className="absolute top-4 inset-x-0 flex justify-center pointer-events-auto z-[1000]"
            >
                <SecondaryButton
                    className="text-xs shadow"
                    onClick={(e) => {
                        e.stopPropagation();
                        // Also stop immediate propagation just in case
                        e.nativeEvent.stopImmediatePropagation();

                        const isFullView = Math.abs(currentRect.x) < 1 &&
                            Math.abs(currentRect.y) < 1 &&
                            Math.abs(currentRect.width - videoSize.width) < 1 &&
                            Math.abs(currentRect.height - videoSize.height) < 1;

                        if (isFullView) return;

                        const newRect = { x: 0, y: 0, width: videoSize.width, height: videoSize.height };
                        handleRectChange(newRect);
                    }}
                    disabled={Math.abs(currentRect.x) < 1 &&
                        Math.abs(currentRect.y) < 1 &&
                        Math.abs(currentRect.width - videoSize.width) < 1 &&
                        Math.abs(currentRect.height - videoSize.height) < 1}
                >
                    Full View
                </SecondaryButton>
            </div>
        </div>
    );
};
