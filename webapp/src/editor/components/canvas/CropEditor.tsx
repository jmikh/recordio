import React, { useRef, useEffect, useMemo, useState } from 'react';
import type { Rect, Project } from '../../../types';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { ViewMapper } from '../../../core/mappers/viewMapper';
import { BoundingBox, type CornerRadii } from './bounding-box';
import { DimmedOverlay } from '../../../components/DimmedOverlay';

// ------------------------------------------------------------------
// LOGIC: Render Strategy
// ------------------------------------------------------------------

export const renderCropEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        currentTimeMs: number,
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project } = state;
    const outputSize = project.settings.outputSize;

    const screenSource = project.screenSource;

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
            borderRadiusPx: 0,
            borderWidthPx: 0, // Hide borders
            hasShadow: false, // Hide shadow
            hasGlow: false, // Hide glow
        }
    };

    // We also need to ignore zoom for the editor view - we want "fit whole video"
    // drawScreen handles ViewMapper creation. If we pass crop=undefined, ViewMapper will fit full video to output (with padding).

    const tempProject = {
        ...project,
        settings: tempSettings
    };

    // Render Screen Layer
    if (screenSource.id) {
        const video = videoRefs[screenSource.id];
        if (video) {
            drawScreen(
                ctx,
                video,
                tempProject,
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
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const updateSettings = useProjectStore(s => s.updateSettings);

    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Get current border radius for screen (all corners linked)
    const screenBorderRadius = project.settings.screen.borderRadiusPx ?? 0;
    const [localBorderRadius, setLocalBorderRadius] = useState(screenBorderRadius);
    const cornerRadii: CornerRadii = useMemo(() => {
        return [localBorderRadius, localBorderRadius, localBorderRadius, localBorderRadius];
    }, [localBorderRadius]);

    // Determine dimensions
    const outputSize = project.settings.outputSize;

    // We need the ACTUAL source dimensions to map Crop Rect (Source Space) -> Output Space
    // Priority: Prop (Video Element) -> Metadata -> Fallback
    const sourceSize = (project.screenSource.size && project.screenSource.size.width > 0)
        ? project.screenSource.size
        : undefined;
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
        project.settings.screen.padding,
        undefined // NO CROP for the mapper, because we are mapping onto the full view
    );

    // Project the Crop Rect to Output Coordinates
    const fullViewport = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
    const renderedRect = viewMapper.projectSourceToOutput(currentCrop, fullViewport);


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
        x: renderedRect.x - viewMapper.contentRect.x,
        y: renderedRect.y - viewMapper.contentRect.y,
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

        batchAction(() => updateSettings({ screen: { crop: newCrop } }));
    };

    // Corner radius handlers for screen border radius
    const handleCornerRadiiChange = (radii: CornerRadii) => {
        // All corners are linked, take the first value
        setLocalBorderRadius(radii[0]);
    };

    const handleCornerRadiiCommit = (radii: CornerRadii) => {
        const newRadius = radii[0];
        batchAction(() => updateSettings({ screen: { borderRadiusPx: newRadius } }));
    };

    // Close when clicking outside the canvas container
    const rootRef = useRef<HTMLDivElement>(null);

    // Start history batch when entering crop mode, end when leaving
    useEffect(() => {
        startInteraction();
        return () => {
            endInteraction();
        };
    }, [startInteraction, endInteraction]);

    return (
        <div
            ref={rootRef}
            className="absolute inset-0 z-[var(--z-index-modal)] overflow-hidden"
        >
            {/* Dimming Layers */}
            <DimmedOverlay
                holeRect={renderedRect}
                cornerRadii={cornerRadii}
            />

            {/* Bounding Box Container */}
            <div style={containerStyle}>
                <BoundingBox
                    rect={relativeRect}
                    constraintBounds={{
                        x: 0,
                        y: 0,
                        width: viewMapper.contentRect.width,
                        height: viewMapper.contentRect.height
                    }}
                    onChange={handleChange}
                    onCommit={() => {
                        endInteraction();
                    }}
                    onDragStart={startInteraction}
                    // Corner radius editing (all corners linked, no toggle)
                    allowCornerEditing={true}
                    cornerRadii={cornerRadii}
                    cornersLinked={true}
                    hideLinkToggle={true}
                    onCornerRadiiChange={handleCornerRadiiChange}
                    onCornerRadiiCommit={handleCornerRadiiCommit}
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
