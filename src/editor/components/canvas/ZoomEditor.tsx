import React, { useRef, useEffect } from 'react';
import type { Rect, Project } from '../../../core/types';
import { useProjectStore, type ProjectState } from '../../stores/useProjectStore';
import type { RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { BoundingBox } from './BoundingBox';

// ------------------------------------------------------------------
// LOGIC: Static Render Strategy
// ------------------------------------------------------------------
export const renderZoomEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        sources: ProjectState['sources'],
        currentTimeMs: number, // KEYFRAME TIME
        editingZoomId: string
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, sources } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = sources[project.timeline.recording.screenSourceId];

    // FORCE FULL VIEWPORT (Identity) for Editing
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Render Screen Layer
    if (screenSource) {
        const video = videoRefs[screenSource.id];
        if (!video) {
            throw new Error(`[ZoomEditor] Video element not found for source ${screenSource.id}`);
        }

        drawScreen(
            ctx,
            video,
            project,
            sources,
            effectiveViewport,
            null // Device frame not needed in zoom edit mode
        );
    }

};


// NOTE: Webcam and Keyboard are HIDDEN in Zoom Edit mode.


// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------

export const ZoomEditor: React.FC = () => {
    // Connect to Store
    const editingZoomId = useProjectStore(s => s.editingZoomId);
    const setEditingZoom = useProjectStore(s => s.setEditingZoom);
    const updateViewportMotion = useProjectStore(s => s.updateViewportMotion);
    const deleteViewportMotion = useProjectStore(s => s.deleteViewportMotion);
    const project = useProjectStore(s => s.project);

    // Derived State
    const videoSize = project.settings.outputSize;
    const initialRect = editingZoomId
        ? project.timeline.recording.viewportMotions.find(m => m.id === editingZoomId)?.rect
        : null;

    if (!initialRect || !editingZoomId) return null;

    // Actions
    const onCommit = (rect: Rect) => updateViewportMotion(editingZoomId, { rect });
    const onCancel = () => setEditingZoom(null);
    const onDelete = () => {
        deleteViewportMotion(editingZoomId);
        setEditingZoom(null);
    };

    const containerRef = useRef<HTMLDivElement>(null);
    // Local state to track rect *during* drag before committing
    const [currentRect, setCurrentRect] = React.useState<Rect>(initialRect);

    // Sync state if initialRect changes externally (e.g. undo/redo)
    useEffect(() => {
        setCurrentRect(initialRect);
    }, [initialRect]);

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
        if (e.target !== containerRef.current) return;

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
        setCurrentRect(newRect);
        onCommit(newRect);
    };

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-50 overflow-hidden text-sm"
            onPointerDown={handleContainerPointerDown}
        >
            <BoundingBox
                rect={currentRect}
                canvasSize={videoSize}
                maintainAspectRatio={true}
                onChange={setCurrentRect}
                onCommit={onCommit}
            >
                {/* Dimming Effect: Shadow around user focus */}
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
                        border: '1px solid rgba(255, 255, 255, 0.5)',
                        pointerEvents: 'none'
                    }}
                />
            </BoundingBox>
        </div>
    );
};
