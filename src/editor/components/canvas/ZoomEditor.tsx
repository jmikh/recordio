import React, { useRef, useEffect } from 'react';
import type { Rect } from '../../../core/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { TimeMapper } from '../../../core/timeMapper';
import { BoundingBox } from './BoundingBox';
import { DimmedOverlay } from '../common/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { type RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import type { ProjectState } from '../../stores/useProjectStore';
import type { Project } from '../../../core/types';

// ------------------------------------------------------------------
// LOGIC: Render Strategy
// ------------------------------------------------------------------
export const renderZoomEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        sources: ProjectState['sources'],
        currentTimeMs: number,
        editingZoomId: string | null,
        previewZoomRect: Rect | null
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, sources, editingZoomId, previewZoomRect } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = sources[project.timeline.recording.screenSourceId];

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

    // Render Camera Layer (Relative to Zoom)
    // 1. Get Camera Source and Settings
    const cameraSettings = project.settings.camera;
    const cameraSourceId = project.timeline.recording.cameraSourceId;
    const cameraSource = cameraSourceId ? sources[cameraSourceId] : undefined;

    // Only render if we have a camera source and it's enabled
    if (cameraSource && cameraSettings) {
        const video = videoRefs[cameraSource.id];
        if (video) {
            // 2. Determine Zoom Rect (Preview or Committed)
            let zoomRect = previewZoomRect;
            if (!zoomRect && editingZoomId) {
                const motion = project.timeline.recording.viewportMotions.find(m => m.id === editingZoomId);
                zoomRect = motion?.rect || null;
            }

            if (zoomRect) {
                // 3. Calculate Relative Position
                // The camera is defined in absolute canvas coordinates (0..outputWidth, 0..outputHeight).
                // We want to project it into the zoomRect.
                //
                // Scale Factor = ZoomRect Width / Output Width

                const scaleFactor = zoomRect.width / outputSize.width;

                const relativeX = (cameraSettings.x / outputSize.width) * zoomRect.width;
                const relativeY = (cameraSettings.y / outputSize.height) * zoomRect.height;

                const projectedX = zoomRect.x + relativeX;
                const projectedY = zoomRect.y + relativeY;
                const projectedW = cameraSettings.width * scaleFactor;
                const projectedH = cameraSettings.height * scaleFactor;

                // 4. Draw Camera
                drawWebcam(
                    ctx,
                    video,
                    cameraSource.size, // Input size
                    {
                        ...cameraSettings,
                        x: projectedX,
                        y: projectedY,
                        width: projectedW,
                        height: projectedH,
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

    // Actions
    const updateViewportMotion = useProjectStore(s => s.updateViewportMotion);
    const deleteViewportMotion = useProjectStore(s => s.deleteViewportMotion);
    const project = useProjectStore(s => s.project);

    // History Batcher
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Sync Playback to Zoom End Time
    useEffect(() => {
        if (!editingZoomId) return;

        const motion = project.timeline.recording.viewportMotions.find(m => m.id === editingZoomId);
        if (motion) {
            const timeMapper = new TimeMapper(
                project.timeline.recording.timelineOffsetMs,
                project.timeline.outputWindows
            );

            const outputTime = timeMapper.mapSourceToOutputTime(motion.sourceEndTimeMs);
            if (outputTime !== -1) {
                const timelineTime = timeMapper.mapOutputToTimelineTime(outputTime);
                if (timelineTime !== -1) {
                    useUIStore.getState().setCurrentTime(timelineTime);
                }
            }
        }
    }, [editingZoomId]); // Reduced dependency to avoid loops

    // Derived State
    const videoSize = project.settings.outputSize;
    const initialRect = editingZoomId
        ? project.timeline.recording.viewportMotions.find(m => m.id === editingZoomId)?.rect
        : null;

    // Actions
    const onCommit = (rect: Rect) => {
        if (!editingZoomId) return;

        batchAction(() => {
            updateViewportMotion(editingZoomId, { rect });
        });
    };

    const onCancel = () => {
        // Just deselect. No "Cancel" of changes because they are applied live now via batcher.
        useUIStore.getState().setCanvasMode(CanvasMode.Preview);
    };

    const onDelete = () => {
        if (editingZoomId) {
            deleteViewportMotion(editingZoomId);
            onCancel();
        }
    };

    const containerRef = useRef<HTMLDivElement>(null);
    // Local state to track rect *during* drag before committing ??
    // Actually, with batchAction, we can commit live?
    // But the BoundingBox calls onCommit on every drag frame?
    // Yes, BoundingBox usually calls onChange while dragging and onCommit on end.
    // If it calls onCommit on end, we don't need batchAction?
    // Wait, typical BoundingBox behavior:
    // "onChange" -> internal state update, visual update.
    // "onCommit" -> final update (mouse up).

    // If BoundingBox only calls onCommit on MouseUp, then we don't strictly need batcher?
    // BUT the user asked for "pause temporal after first update".
    // This implies we ARE updating the store *during* the drag (live updates).
    // So "onChange" should probably call "onCommit" (updateStore)?

    // Let's assume BoundingBox's onChange is for live updates.
    // If we want the store to have live updates (so the renderer draws it), we must update the store in onChange.

    // Refactor:
    // handleRectChange (onChange) -> batchAction(updateStore)
    // onCommit -> endInteraction()

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
                updateViewportMotion(editingZoomId, { rect: newRect });
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

    // Close when clicking strictly outside the container
    useEffect(() => {
        const handleGlobalPointerDown = (e: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onCancel();
            }
        };
        window.addEventListener('pointerdown', handleGlobalPointerDown);
        return () => window.removeEventListener('pointerdown', handleGlobalPointerDown);
    }, [onCancel]);

    // Click on background moves the zoom box
    const handleContainerPointerDown = (e: React.PointerEvent) => {
        // Only trigger if clicking the container background directly
        if (e.target !== containerRef.current || !initialRect) return;

        if (e.target !== containerRef.current || !initialRect) return;

        const rect = containerRef.current.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        // Center around click
        const targetX = (offsetX / rect.width) * videoSize.width;
        const targetY = (offsetY / rect.height) * videoSize.height;

        let newX = targetX - initialRect.width / 2;
        let newY = targetY - initialRect.height / 2;

        // Clamp
        if (newX < 0) newX = 0;
        if (newX + initialRect.width > videoSize.width) newX = videoSize.width - initialRect.width;
        if (newY < 0) newY = 0;
        if (newY + initialRect.height > videoSize.height) newY = videoSize.height - initialRect.height;

        const newRect = { ...initialRect, x: newX, y: newY };
        handleRectChange(newRect); // This now triggers batchAction update
    };




    if (!initialRect || !editingZoomId) return null;

    // ... Bounding Box Props ...
    // onChange -> handleRectChange (Live updates via batcher)
    // onCommit -> (Currently does nothing special, maybe final sync?)
    // onDragStart -> startInteraction
    // onDragEnd -> endInteraction

    // Check if BoundingBox supports onDragStart/End.
    // If NOT, I might need to verify file content again. I viewed it previously.
    // It has `onChange` and `onCommit`. usually onCommit is end of drag.
    // So onDragStart is missing?

    // I entered this assuming BoundingBox needs modification or I wrap it.
    // Let's assume onCommit is "End of Drag".
    // But "Start of Drag" is implicit in first interaction logic of batcher?
    // NO, batcher requires `startInteraction()` to be called explicitly to reset the latch!

    // I will wrap BoundingBox in a div that captures pointer down? No, BoundingBox handles dragging.
    // I should check BoundingBox.tsx to see if I can add onInteractionStart/End props or if I need to rely on onCommit for End.

    // For now, I'll assume I can pass `onPointerDownCapture={startInteraction}` to the bounding box container?


    if (!initialRect || !editingZoomId) return null;

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-50 overflow-hidden text-sm"
            onPointerDown={handleContainerPointerDown}
        >
            <DimmedOverlay
                holeRect={currentRect}
                containerSize={videoSize}
            />
            <BoundingBox
                rect={currentRect}
                canvasSize={videoSize}
                maintainAspectRatio={true}
                onChange={handleRectChange}
                onCommit={onCommit}
            />
        </div>
    );
};
