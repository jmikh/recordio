import React, { useRef, useEffect } from 'react';
import type { Rect, Project } from '../../../core/types';
import { useProjectStore, type ProjectState } from '../../stores/useProjectStore';
import type { RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';

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
            effectiveViewport
        );
    }

};


// NOTE: Webcam and Keyboard are HIDDEN in Zoom Edit mode.


// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------
type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se';

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
    const zoomBoxRef = useRef<HTMLDivElement>(null);
    const startDragRef = useRef<{ type: InteractionType, x: number, y: number, initialRect: Rect } | null>(null);

    // We update this Ref during drag. On PointerUp, we flush this to the store via onCommit.
    const currentDragRectRef = useRef<Rect>(initialRect);

    // Reset drag ref when selection changes
    useEffect(() => {
        currentDragRectRef.current = initialRect;
    }, [initialRect]);

    const handlePointerDown = (e: React.PointerEvent, type: InteractionType) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        startDragRef.current = {
            type,
            x: e.clientX,
            y: e.clientY,
            initialRect: { ...currentDragRectRef.current }
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!startDragRef.current || !containerRef.current) return;

        const currentWidth = containerRef.current.offsetWidth;
        if (currentWidth === 0) return;

        const { type, initialRect: dragStartRect, x: startX, y: startY } = startDragRef.current;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const scale = videoSize.width / currentWidth;

        const scaledDeltaX = deltaX * scale;
        const scaledDeltaY = deltaY * scale;

        const maxW = videoSize.width;
        const maxH = videoSize.height;
        const aspectRatio = maxW / maxH;

        let newRect = { ...dragStartRect };

        if (type === 'move') {
            // 1. Apply Move
            newRect.x += scaledDeltaX;
            newRect.y += scaledDeltaY;

            // 2. Clamp
            // X Bounds
            if (newRect.x < 0) newRect.x = 0;
            if (newRect.x + newRect.width > maxW) newRect.x = maxW - newRect.width;

            // Y Bounds
            if (newRect.y < 0) newRect.y = 0;
            if (newRect.y + newRect.height > maxH) newRect.y = maxH - newRect.height;

        } else {
            // RESIZING
            let proposedWidth = dragStartRect.width;

            if (type === 'se' || type === 'ne') {
                proposedWidth += scaledDeltaX;
            } else { // sw, nw
                proposedWidth -= scaledDeltaX;
            }

            if (proposedWidth < 100) proposedWidth = 100;
            const minW = maxW / 4;
            if (proposedWidth < minW) proposedWidth = minW;

            // Anchor Points
            const bottom = dragStartRect.y + dragStartRect.height;
            const right = dragStartRect.x + dragStartRect.width;

            if (type === 'se') {
                const maxAvailableW = maxW - dragStartRect.x;
                const maxAvailableH_asW = (maxH - dragStartRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;

            } else if (type === 'sw') {
                const maxAvailableW = right;
                const maxAvailableH_asW = (maxH - dragStartRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;

            } else if (type === 'ne') {
                const maxAvailableW = maxW - dragStartRect.x;
                const maxAvailableH_asW = bottom * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.y = bottom - newRect.height;

            } else if (type === 'nw') {
                const maxAvailableW = right;
                const maxAvailableH_asW = bottom * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;
                newRect.y = bottom - newRect.height;
            }
        }

        // UPDATE LOCAL REF ONLY
        currentDragRectRef.current = newRect;

        // DIRECT DOM UPDATE
        if (zoomBoxRef.current) {
            zoomBoxRef.current.style.left = `${(newRect.x / videoSize.width) * 100}%`;
            zoomBoxRef.current.style.top = `${(newRect.y / videoSize.height) * 100}%`;
            zoomBoxRef.current.style.width = `${(newRect.width / videoSize.width) * 100}%`;
            zoomBoxRef.current.style.height = `${(newRect.height / videoSize.height) * 100}%`;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (startDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit(currentDragRectRef.current);
            startDragRef.current = null;
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
    }, [onDelete, onCancel]);

    // Close when clicking outside
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
        console.log("handleContainerPointerDown", e.currentTarget, e.target);
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

        onCommit({ ...initialRect, x: newX, y: newY });
    };

    // Handle Component
    const Handle = ({ type, cursor }: { type: InteractionType, cursor: string }) => {
        const size = 20; // Hit area size
        const thickness = 2; // Border thickness
        const length = 10; // Length of the corner arm

        // Base container for hit area
        const containerStyle: React.CSSProperties = {
            position: 'absolute',
            width: size,
            height: size,
            cursor: cursor,
            zIndex: 10,
            // Debug:
            // backgroundColor: 'rgba(255, 0, 0, 0.2)',
        };

        // Inner visual element for the corner
        const cornerStyle: React.CSSProperties = {
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderColor: '#fff',
            borderStyle: 'solid',
            borderWidth: 0,
        };

        const isNorth = type.includes('n');
        const isWest = type.includes('w');

        if (isNorth) {
            containerStyle.top = 0;
            cornerStyle.top = 0;
            cornerStyle.borderTopWidth = thickness;
        } else {
            containerStyle.bottom = 0;
            cornerStyle.bottom = 0;
            cornerStyle.borderBottomWidth = thickness;
        }

        if (isWest) {
            containerStyle.left = 0;
            cornerStyle.left = 0;
            cornerStyle.borderLeftWidth = thickness;
        } else {
            containerStyle.right = 0;
            cornerStyle.right = 0;
            cornerStyle.borderRightWidth = thickness;
        }

        cornerStyle.width = length;
        cornerStyle.height = length;

        return (
            <div
                style={containerStyle}
                onPointerDown={(e) => handlePointerDown(e, type)}
            >
                <div style={cornerStyle} />
            </div>
        );
    };

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-50 overflow-hidden"
            onPointerDown={handleContainerPointerDown}
        >
            <div
                ref={zoomBoxRef}
                className="absolute cursor-move"
                style={{
                    left: `${(initialRect.x / videoSize.width) * 100}%`,
                    top: `${(initialRect.y / videoSize.height) * 100}%`,
                    width: `${(initialRect.width / videoSize.width) * 100}%`,
                    height: `${(initialRect.height / videoSize.height) * 100}%`,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.5)'
                }}
                onClick={(e) => {
                    e.stopPropagation();
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                <Handle type="nw" cursor="nw-resize" />
                <Handle type="ne" cursor="ne-resize" />
                <Handle type="sw" cursor="sw-resize" />
                <Handle type="se" cursor="se-resize" />


            </div>
        </div>
    );
};
