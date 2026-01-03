import React, { useRef, useEffect } from 'react';
import type { Rect, Project } from '../../../core/types';
import { useProjectStore, type ProjectState, useProjectData } from '../../stores/useProjectStore';
import type { RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { ViewMapper } from '../../../core/viewMapper';
import { useClickOutside } from '../../hooks/useClickOutside';

// ------------------------------------------------------------------
// LOGIC: Render Strategy
// ------------------------------------------------------------------
export const renderCropEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        sources: ProjectState['sources'],
        currentTimeMs: number,
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, sources } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = sources[project.timeline.recording.screenSourceId];

    // Force Full Viewport
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    // Create a temporary project that IGNORES crop settings for rendering the "Full" video
    // We want the user to see the full input video so they can select a crop region
    // Also hide radius, borders, and frames for cleaner crop editing view
    const tempSettings = {
        ...project.settings,
        background: {
            ...project.settings.background,
            padding: 0.05 // Force consistent padding during crop editing
        },
        screen: {
            ...project.settings.screen,
            crop: undefined, // Force undefined to see full video
            mode: 'border' as const, // Force non-device mode to hide frames
            borderRadius: 0, // Hide rounding
            borderWidth: 0, // Hide borders
            hasShadow: false, // Hide shadow
            hasGlow: false // Hide glow
        }
    };

    // We also need to ignore zoom for the editor view - we want "fit whole video"
    // drawScreen handles ViewMapper creation. If we pass crop=undefined, ViewMapper will fit full video to output (with padding).

    const tempProject = {
        ...project,
        settings: tempSettings
    };

    // Render Screen Layer
    if (screenSource) {
        const video = videoRefs[screenSource.id];
        if (!video) {
            // If video not loaded, we might skip or show placeholder. 
            // drawScreen throws if video missing usually, or handling internally?
            // screenPainter: drawScreen checks video source existence but assumes video element passed is valid?
            // actually drawScreen takes "video" HTMLVideoElement.
        }

        if (video) {
            drawScreen(
                ctx,
                video,
                tempProject,
                sources,
                effectiveViewport,
                null // Device frame not needed in crop edit mode
            );
        }
    }
};


// ------------------------------------------------------------------
// COMPONENT: Interactive Overlay
// ------------------------------------------------------------------
type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const CropEditor: React.FC<{ videoSize?: { width: number, height: number } }> = ({ videoSize }) => {
    // Connect to Store
    const project = useProjectData();
    const setEditingCrop = useProjectStore(s => s.setEditingCrop);
    const sources = useProjectStore(s => s.sources);

    const { startInteraction, endInteraction, updateWithBatching } = useHistoryBatcher();

    // Determine dimensions
    const outputSize = project.settings.outputSize;
    const screenSource = sources[project.timeline.recording.screenSourceId];

    // We need the ACTUAL source dimensions to map Crop Rect (Source Space) -> Output Space
    // Priority: Prop (Video Element) -> Metadata -> Fallback
    const sourceSize = (screenSource?.size && screenSource.size.width > 0) ? screenSource.size : undefined;
    const resolvedSize = (videoSize && videoSize.width > 0) ? videoSize : sourceSize;
    const inputSize = resolvedSize || { width: 1920, height: 1080 }; // Final Fallback

    // Current Crop (or default to full)
    const currentCrop = project.settings.screen.crop || { x: 0, y: 0, ...inputSize };

    // We need a ViewMapper that matches what `renderCropEditor` does (Full Video -> Output)
    // So we can project the Crop Rect from Source Space -> Screen Space
    // Use same 0.05 padding as renderCropEditor to ensure overlay aligns with rendered video
    const viewMapper = new ViewMapper(
        inputSize,
        outputSize,
        0.05, // Force same padding as renderCropEditor
        undefined // NO CROP for the mapper, because we are mapping onto the full view
    );

    // Project the Crop Rect to Screen Coordinates
    const screenRect = viewMapper.projectToScreen(
        { x: currentCrop.x, y: currentCrop.y },
        { x: 0, y: 0, width: outputSize.width, height: outputSize.height }
    );
    // Calculate width/height from bottom-right to ensure scaling is correct
    const screenBottomRight = viewMapper.projectToScreen(
        { x: currentCrop.x + currentCrop.width, y: currentCrop.y + currentCrop.height },
        { x: 0, y: 0, width: outputSize.width, height: outputSize.height }
    );

    const renderedRect: Rect = {
        x: screenRect.x,
        y: screenRect.y,
        width: screenBottomRight.x - screenRect.x,
        height: screenBottomRight.y - screenRect.y
    };


    const containerRef = useRef<HTMLDivElement>(null);
    const startDragRef = useRef<{ type: InteractionType, x: number, y: number, initialCrop: Rect } | null>(null);
    const currentDragCropRef = useRef<Rect>(currentCrop);

    // Sync ref
    useEffect(() => {
        currentDragCropRef.current = currentCrop;
    }, [currentCrop]);


    const handlePointerDown = (e: React.PointerEvent, type: InteractionType) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        startInteraction();

        startDragRef.current = {
            type,
            x: e.clientX,
            y: e.clientY,
            initialCrop: { ...currentDragCropRef.current }
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!startDragRef.current || !containerRef.current) return;

        // Visual calculations rely on converting Screen Delta -> Source Delta
        // We know the "Scale" of the ViewMapper (Output / Input)

        const containerRect = containerRef.current.getBoundingClientRect();

        // 1. Mouse Delta (Screen Pixels)
        const deltaX = e.clientX - startDragRef.current.x;
        const deltaY = e.clientY - startDragRef.current.y;

        // 2. Convert to Output Space Delta
        // Scale Factor = OutputWidth / VisualWidth
        const screenScaleX = outputSize.width / containerRect.width;
        const screenScaleY = outputSize.height / containerRect.height;

        const outputDeltaX = deltaX * screenScaleX;
        const outputDeltaY = deltaY * screenScaleY;

        // 3. Convert to Source Space Delta
        // Scale = Source / Output (inverse of viewMapper scale)
        // Actually viewMapper.contentRect is the size in Output Space.
        // The scale factor of video content is contentRect.width / inputSize.width.
        // So SourceDelta = OutputDelta / (contentRect.width / inputSize.width)
        const videoScale = viewMapper.contentRect.width / inputSize.width;

        const sourceDeltaX = outputDeltaX / videoScale;
        const sourceDeltaY = outputDeltaY / videoScale;

        const { type, initialCrop } = startDragRef.current;
        let newCrop = { ...initialCrop };

        // Constraints
        const MIN_SIZE = Math.min(inputSize.width, inputSize.height) / 5; // e.g. 20%
        const maxW = inputSize.width;
        const maxH = inputSize.height;

        if (type === 'move') {
            newCrop.x += sourceDeltaX;
            newCrop.y += sourceDeltaY;

            // Clamp Position
            if (newCrop.x < 0) newCrop.x = 0;
            if (newCrop.y < 0) newCrop.y = 0;
            if (newCrop.x + newCrop.width > maxW) newCrop.x = maxW - newCrop.width;
            if (newCrop.y + newCrop.height > maxH) newCrop.y = maxH - newCrop.height;
        } else {
            // RESIZING
            // Similar logic to ZoomEditor but in Source Space

            if (type === 'se' || type === 'ne') {
                newCrop.width += sourceDeltaX;
            } else { // sw, nw
                newCrop.width -= sourceDeltaX;
                newCrop.x += sourceDeltaX;
            }

            if (type === 'se' || type === 'sw') {
                newCrop.height += sourceDeltaY;
            } else { // ne, nw
                newCrop.height -= sourceDeltaY;
                newCrop.y += sourceDeltaY;
            }

            // Min Size
            if (newCrop.width < MIN_SIZE) {
                // If we hit min, we need to adjust x if we were moving left edge
                const diff = MIN_SIZE - newCrop.width;
                newCrop.width = MIN_SIZE;
                if (type === 'sw' || type === 'nw') newCrop.x -= diff;
            }
            if (newCrop.height < MIN_SIZE) {
                const diff = MIN_SIZE - newCrop.height;
                newCrop.height = MIN_SIZE;
                if (type === 'ne' || type === 'nw') newCrop.y -= diff;
            }

            // Bounds Clamping
            // This is tricky for resizing.
            if (newCrop.x < 0) { newCrop.width += newCrop.x; newCrop.x = 0; }
            if (newCrop.y < 0) { newCrop.height += newCrop.y; newCrop.y = 0; }
            if (newCrop.x + newCrop.width > maxW) newCrop.width = maxW - newCrop.x;
            if (newCrop.y + newCrop.height > maxH) newCrop.height = maxH - newCrop.y;
        }

        currentDragCropRef.current = newCrop;
        updateWithBatching({ screen: { crop: newCrop } });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (startDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            endInteraction();
            startDragRef.current = null;
        }
    };

    // Close when clicking outside the canvas container
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        // Store reference to the canvas container (parent of our overlay)
        canvasContainerRef.current = containerRef.current?.parentElement as HTMLDivElement;
    }, []);

    useClickOutside(canvasContainerRef, () => {
        setEditingCrop(false);
    });

    // L-shaped corner handles (matching ZoomEditor)
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

    // Convert to Percentages for rendering (handling CSS scaling of container)
    const toPct = (val: number, ref: number) => (val / ref) * 100;

    const leftPct = toPct(renderedRect.x, outputSize.width);
    const topPct = toPct(renderedRect.y, outputSize.height);
    const widthPct = toPct(renderedRect.width, outputSize.width);
    const heightPct = toPct(renderedRect.height, outputSize.height);

    // Check if crop is centered
    const isCentered = Math.abs(currentCrop.x - (inputSize.width - currentCrop.width) / 2) < 1 &&
        Math.abs(currentCrop.y - (inputSize.height - currentCrop.height) / 2) < 1;

    // Check if crop is full view
    const isFullView = Math.abs(currentCrop.x) < 1 &&
        Math.abs(currentCrop.y) < 1 &&
        Math.abs(currentCrop.width - inputSize.width) < 1 &&
        Math.abs(currentCrop.height - inputSize.height) < 1;

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 z-50 overflow-hidden"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {/* Dimming Layers - simplistic approach: One big div with hole using clip-path */}
            <div
                className="absolute inset-0 bg-black/60 pointer-events-none"
                style={{
                    clipPath: `polygon(
                    0% 0%, 
                    0% 100%, 
                    100% 100%, 
                    100% 0%, 
                    0% 0%, 
                    ${leftPct}% ${topPct}%, 
                    ${leftPct + widthPct}% ${topPct}%, 
                    ${leftPct + widthPct}% ${topPct + heightPct}%, 
                    ${leftPct}% ${topPct + heightPct}%, 
                    ${leftPct}% ${topPct}%
                  )`
                }}
            />

            {/* Toolbar - Positioned relative to the actual Video Content (viewMapper.contentRect) */}
            <div
                className="absolute flex gap-2 pointer-events-auto justify-center"
                style={{
                    left: `${toPct(viewMapper.contentRect.x, outputSize.width)}%`,
                    top: `calc(${toPct(viewMapper.contentRect.y, outputSize.height)}% - 40px)`,
                    width: `${toPct(viewMapper.contentRect.width, outputSize.width)}%`,
                }}
            >
                <button
                    className={`text-xs px-3 py-1.5 rounded shadow font-medium transition-colors ${isCentered
                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-700 hover:bg-gray-600 text-white'
                        }`}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isCentered) return;

                        // Center Logic
                        const newX = (inputSize.width - currentCrop.width) / 2;
                        const newY = (inputSize.height - currentCrop.height) / 2;
                        const newCrop = { ...currentCrop, x: newX, y: newY };

                        // Use direct store update for immediate reliable action
                        useProjectStore.getState().updateSettings({ screen: { crop: newCrop } });
                    }}
                    disabled={isCentered}
                >
                    Center
                </button>

                <button
                    className={`text-xs px-3 py-1.5 rounded shadow font-medium transition-colors ${isFullView
                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-700 hover:bg-gray-600 text-white'
                        }`}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isFullView) return;

                        // Full View Logic
                        const newCrop = { x: 0, y: 0, width: inputSize.width, height: inputSize.height };

                        // Use direct store update for immediate reliable action
                        useProjectStore.getState().updateSettings({ screen: { crop: newCrop } });
                    }}
                    disabled={isFullView}
                >
                    Full View
                </button>
            </div>

            {/* Crop Box */}
            <div
                className="absolute cursor-move"
                style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${widthPct}%`,
                    height: `${heightPct}%`,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.5)'
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
            >
                {/* Rule of Thirds Grid (Optional) */}
                <div className="absolute inset-0 flex flex-col pointer-events-none opacity-30">
                    <div className="flex-1 border-b border-white/50" />
                    <div className="flex-1 border-b border-white/50" />
                    <div className="flex-1" />
                </div>
                <div className="absolute inset-0 flex pointer-events-none opacity-30">
                    <div className="flex-1 border-r border-white/50" />
                    <div className="flex-1 border-r border-white/50" />
                    <div className="flex-1" />
                </div>

                <Handle type="nw" cursor="nw-resize" />
                <Handle type="ne" cursor="ne-resize" />
                <Handle type="sw" cursor="sw-resize" />
                <Handle type="se" cursor="se-resize" />
            </div>
        </div>
    );
};
