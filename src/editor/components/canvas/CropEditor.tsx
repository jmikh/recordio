import React, { useRef, useEffect } from 'react';
import type { Rect, Project } from '../../../core/types';
import { useProjectStore, type ProjectState, useProjectData } from '../../stores/useProjectStore';
import type { RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { ViewMapper } from '../../../core/viewMapper';
import { useClickOutside } from '../../hooks/useClickOutside';
import { BoundingBox } from './BoundingBox';

// ------------------------------------------------------------------
// LOGIC: Render Strategy
// ------------------------------------------------------------------

const EDITOR_PADDING = 0.05;

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
        screen: {
            ...project.settings.screen,
            crop: undefined, // Force undefined to see full video
            mode: 'border' as const, // Force non-device mode to hide frames
            borderRadius: 0, // Hide rounding
            borderWidth: 0, // Hide borders
            hasShadow: false, // Hide shadow
            hasGlow: false, // Hide glow
            padding: EDITOR_PADDING // Force consistent padding during crop editing
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
    // Use same padding as renderCropEditor to ensure overlay aligns with rendered video
    const viewMapper = new ViewMapper(
        inputSize,
        outputSize,
        EDITOR_PADDING, // Force same padding as renderCropEditor
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


    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    // Convert to Percentages for rendering (handling CSS scaling of container)
    const toPct = (val: number, ref: number) => (val / ref) * 100;

    // 1. Calculate the container for the BoundingBox (Screen Space of the Video Content)
    // viewMapper.contentRect is exactly this.
    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${toPct(viewMapper.contentRect.x, outputSize.width)}%`,
        top: `${toPct(viewMapper.contentRect.y, outputSize.height)}%`,
        width: `${toPct(viewMapper.contentRect.width, outputSize.width)}%`,
        height: `${toPct(viewMapper.contentRect.height, outputSize.height)}%`,
        // debug: backgroundColor: 'rgba(0, 255, 0, 0.2)'
    };

    // 2. Calculate the Rect for BoundingBox (Relative to the Container)
    const relativeRect: Rect = {
        x: screenRect.x - viewMapper.contentRect.x,
        y: screenRect.y - viewMapper.contentRect.y,
        width: renderedRect.width,
        height: renderedRect.height
    };

    const handleChange = (newRelativeRect: Rect) => {
        // Convert Relative Screen Space -> Source Space
        // Scale = Source / ScreenContainer
        const scaleX = inputSize.width / viewMapper.contentRect.width;
        const scaleY = inputSize.height / viewMapper.contentRect.height;

        const newCrop: Rect = {
            x: newRelativeRect.x * scaleX,
            y: newRelativeRect.y * scaleY,
            width: newRelativeRect.width * scaleX,
            height: newRelativeRect.height * scaleY
        };

        updateWithBatching({ screen: { crop: newCrop } });
    };

    // Close when clicking outside the canvas container
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        // Store reference to the canvas container (parent of our overlay)
        canvasContainerRef.current = rootRef.current?.parentElement as HTMLDivElement;
    }, []);

    useClickOutside(canvasContainerRef, () => {
        endInteraction();
        setEditingCrop(false);
    });

    // Start history batch when entering crop mode, end when leaving
    useEffect(() => {
        startInteraction();
        return () => {
            endInteraction();
        };
    }, [startInteraction, endInteraction]);

    // Convert to Percentages for rendering (handling CSS scaling of container) for Dimming Layer
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
            ref={rootRef}
            className="absolute inset-0 z-50 overflow-hidden"
        >
            {/* Dimming Layers */}
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

            {/* Toolbar */}
            <div
                className="absolute flex gap-2 pointer-events-auto justify-center z-[60]"
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

                        const newX = (inputSize.width - currentCrop.width) / 2;
                        const newY = (inputSize.height - currentCrop.height) / 2;
                        const newCrop = { ...currentCrop, x: newX, y: newY };

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

                        const newCrop = { x: 0, y: 0, width: inputSize.width, height: inputSize.height };

                        useProjectStore.getState().updateSettings({ screen: { crop: newCrop } });
                    }}
                    disabled={isFullView}
                >
                    Full View
                </button>
            </div>

            {/* Bounding Box Container */}
            <div style={containerStyle}>
                <BoundingBox
                    rect={relativeRect}
                    canvasSize={{ width: viewMapper.contentRect.width, height: viewMapper.contentRect.height }}
                    onChange={handleChange}
                    onCommit={() => {
                        endInteraction();
                        // Also sync exact state if needed, but change handled it.
                    }}
                    onDragStart={startInteraction}
                >
                    {/* Visual Overlay inside the box (Rule of Thirds) */}
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
                </BoundingBox>
            </div>
        </div>
    );
};
