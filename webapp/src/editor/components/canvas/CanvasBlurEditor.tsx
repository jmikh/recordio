import React, { useEffect, useRef, useState } from 'react';
import type { Point, Rect, Project, BlurRegion } from '@shared/types';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { BoundingBox, type CornerRadii } from './bounding-box';

import type { RenderResources } from '@shared/export/PlaybackRenderer';
import { drawScreen } from '@shared/painters/screenPainter';
import { drawBlurSegment } from '@shared/painters/blurPainter';
import { MIN_BLUR_REGION_FRACTION } from '../../blur/blurDefaults';

// ------------------------------------------------------------------
// LOGIC: Render Strategy (for BlurEdit mode)
// Renders the screen without zoom (full viewport), same as the spotlight
// editor, then blurs every region of the segment being edited — whatever
// the playhead time, so the regions stay visible while editing.
// ------------------------------------------------------------------
export const renderBlurEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        editingSegmentId: string,
        /** In-drag replica of one region, painted instead of its stored version */
        previewRegion: BlurRegion | null,
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, previewRegion } = state;
    const outputSize = project.settings.outputSize;
    const screenSource = project.screenSource;

    // Force full viewport (ignore current zoom) so user can see context
    const effectiveViewport: Rect = { x: 0, y: 0, width: outputSize.width, height: outputSize.height };

    if (screenSource.storagePath) {
        const video = videoRefs[screenSource.storagePath];
        if (video) {
            drawScreen(ctx, video, project, effectiveViewport, resources.deviceFrameImg);
        }
    }

    const segment = project.timeline.blurSegments.find(s => s.id === state.editingSegmentId);
    if (!segment) return;
    const regions = previewRegion
        ? segment.regions.map(r => (r.id === previewRegion.id ? previewRegion : r))
        : segment.regions;
    drawBlurSegment(ctx, segment, outputSize, effectiveViewport, regions);
};

// ------------------------------------------------------------------
// COMPONENT: Interactive HTML Overlay
// The selected region gets the bounding box; the segment's other regions
// are outlines that select on click; dragging on empty canvas draws a new
// region into the segment.
// ------------------------------------------------------------------

export const BlurEditor: React.FC<{ previewRegionRef: React.MutableRefObject<BlurRegion | null> }> = ({ previewRegionRef }) => {
    const displayMapper = useDisplayMapper();
    const segmentId = useUIStore(s => s.selectedBlurSegmentId);
    const selectedRegionId = useUIStore(s => s.selectedBlurRegionId);
    const selectBlurRegion = useUIStore(s => s.selectBlurRegion);
    const segment = useProjectStore(s => s.project.timeline.blurSegments.find(b => b.id === segmentId));
    const updateBlurRegion = useProjectStore(s => s.updateBlurRegion);
    const addBlurRegion = useProjectStore(s => s.addBlurRegion);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // In-drag replica of the active region. Mirrors previewRegionRef (which the
    // canvas loop reads) as state so the bounding box re-renders while dragging.
    const [preview, setPreview] = useState<BlurRegion | null>(null);

    // Drag-to-draw a new region (output coordinates)
    const drawStartRef = useRef<Point | null>(null);
    const [draft, setDraft] = useState<Rect | null>(null);

    useEffect(() => () => { previewRegionRef.current = null; }, [previewRegionRef]);

    if (!segment || !displayMapper) return null;

    const outputSize = displayMapper.outputSize;
    const minSize = Math.min(outputSize.width, outputSize.height) * MIN_BLUR_REGION_FRACTION;
    // Fall back to the first region if the selected one is gone (e.g. undo)
    const activeRegion = segment.regions.find(r => r.id === selectedRegionId) ?? segment.regions[0];

    // ── Active region (bounding box) ────────────────────────────
    const previewActive = (updates: Partial<BlurRegion>) => {
        const next = { ...(previewRegionRef.current ?? activeRegion), ...updates };
        previewRegionRef.current = next;
        setPreview(next);
    };
    const commitActive = (updates: Partial<Omit<BlurRegion, 'id'>>) => {
        batchAction(() => updateBlurRegion(segment.id, activeRegion.id, updates));
        endInteraction();
        previewRegionRef.current = null;
        setPreview(null);
    };
    const activeRect = preview?.id === activeRegion.id ? preview.rectPx : activeRegion.rectPx;

    // ── Drawing a new region ────────────────────────────────────
    const toOutputPoint = (e: React.PointerEvent): Point => {
        const bounds = e.currentTarget.getBoundingClientRect();
        const p = displayMapper.displayToOutput({
            x: e.clientX - bounds.left,
            y: e.clientY - bounds.top,
            width: 0,
            height: 0,
        });
        return {
            x: Math.max(0, Math.min(outputSize.width, p.x)),
            y: Math.max(0, Math.min(outputSize.height, p.y)),
        };
    };

    const rectBetween = (a: Point, b: Point): Rect => ({
        x: Math.round(Math.min(a.x, b.x)),
        y: Math.round(Math.min(a.y, b.y)),
        width: Math.round(Math.abs(b.x - a.x)),
        height: Math.round(Math.abs(b.y - a.y)),
    });

    const handleDrawPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drawStartRef.current = toOutputPoint(e);
    };

    const handleDrawPointerMove = (e: React.PointerEvent) => {
        if (!drawStartRef.current) return;
        setDraft(rectBetween(drawStartRef.current, toOutputPoint(e)));
    };

    const handleDrawPointerUp = (e: React.PointerEvent) => {
        if (!drawStartRef.current) return;
        const rect = rectBetween(drawStartRef.current, toOutputPoint(e));
        drawStartRef.current = null;
        setDraft(null);
        if (rect.width < minSize || rect.height < minSize) return;

        const region: BlurRegion = { id: crypto.randomUUID(), rectPx: rect, borderRadiusPx: [0, 0, 0, 0] };
        addBlurRegion(segment.id, region);
        selectBlurRegion(region.id);
    };

    const draftDisplay = draft ? displayMapper.outputToDisplay(draft) : null;

    return (
        <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
            {/* Contrasting outline for bounding box visibility on any background */}
            <style>{`
                .blur-editor-contrast #bounding-box {
                    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
                }
            `}</style>

            {/* Draw layer — drag on empty canvas to add a region */}
            <div
                className="absolute inset-0 pointer-events-auto cursor-crosshair"
                onPointerDown={handleDrawPointerDown}
                onPointerMove={handleDrawPointerMove}
                onPointerUp={handleDrawPointerUp}
                onPointerCancel={() => { drawStartRef.current = null; setDraft(null); }}
            />

            {/* Other regions — click to select */}
            {segment.regions.filter(r => r.id !== activeRegion.id).map(region => {
                const d = displayMapper.outputToDisplay(region.rectPx);
                return (
                    <div
                        key={region.id}
                        role="button"
                        aria-label="Select blur region"
                        className="absolute pointer-events-auto cursor-pointer border border-dashed border-secondary hover:border-solid"
                        style={{ left: d.x, top: d.y, width: d.width, height: d.height }}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            selectBlurRegion(region.id);
                        }}
                    />
                );
            })}

            {/* Region being drawn */}
            {draftDisplay && (
                <div
                    className="absolute border border-dashed border-secondary pointer-events-none"
                    style={{ left: draftDisplay.x, top: draftDisplay.y, width: draftDisplay.width, height: draftDisplay.height }}
                />
            )}

            {/* Selected region — interactive bounding box */}
            <div className="blur-editor-contrast">
                <BoundingBox
                    key={activeRegion.id}
                    rect={activeRect}
                    minSize={minSize}
                    hideLinkToggle
                    allowCornerEditing
                    cornerRadii={activeRegion.borderRadiusPx}
                    onDragStart={startInteraction}
                    onChange={(rect) => previewActive({ rectPx: rect })}
                    onCommit={(rect) => commitActive({ rectPx: rect })}
                    onCornerRadiiChange={(radii: CornerRadii) => previewActive({ borderRadiusPx: radii })}
                    onCornerRadiiCommit={(radii: CornerRadii) => commitActive({ borderRadiusPx: radii })}
                />
            </div>
        </div>
    );
};
