/**
 * OverlayHoverLayer
 *
 * Always-mounted background layer that renders hover targets for overlay items
 * at the current time. Self-gates: only active when paused, not in zoom/spotlight
 * editor, and overlay is enabled.
 *
 * Accounts for the current zoom viewport when positioning hover targets.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';
import { getViewportStateAtTime } from '../../../core/zoom';
import type { OverlaySegment, BlurOverlayItem, BorderOverlayItem, ArrowOverlayItem, TextOverlayItem } from '../../../types/overlay';
import type { Rect } from '../../../types';

export const OverlayHoverLayer: React.FC = () => {
    const isPlaying = useUIStore(s => s.isPlaying);
    const canvasMode = useUIStore(s => s.canvasMode);
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const selectedOverlayId = useUIStore(s => s.selectedOverlaySegmentId);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const selectOverlaySegment = useUIStore(s => s.selectOverlaySegment);

    const project = useProjectStore(s => s.project);
    const overlayEnabled = project.settings.overlay?.enabled ?? true;
    const zoomEnabled = project.settings.zoom?.enabled ?? true;
    const outputSize = project.settings.outputSize;

    const displayMapper = useDisplayMapper();
    const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);

    // Gate: only active when paused, not in zoom/spotlight editor, overlays enabled
    const isActive = !isPlaying
        && canvasMode !== CanvasMode.ZoomEdit
        && canvasMode !== CanvasMode.SpotlightEdit
        && overlayEnabled;

    // Get current zoom viewport
    const viewport = useMemo(() => {
        if (!isActive) return { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
        const zoomSegments = zoomEnabled ? (project.timeline.zoomSegments || []) : [];
        return getViewportStateAtTime(zoomSegments, currentTimeMs, outputSize, project.settings.zoom);
    }, [isActive, zoomEnabled, project.timeline.zoomSegments, currentTimeMs, outputSize, project.settings.zoom]);

    // Get visible overlay segments at current time (excluding selected)
    const visibleSegments = useMemo(() => {
        if (!isActive) return [];
        return (project.timeline.overlaySegments || []).filter((s: OverlaySegment) =>
            s.visible
            && s.id !== selectedOverlayId
            && currentTimeMs >= s.outputStartTimeMs
            && currentTimeMs <= s.outputEndTimeMs
        );
    }, [isActive, project.timeline.overlaySegments, currentTimeMs, selectedOverlayId]);

    const handleClick = useCallback((e: React.MouseEvent, segmentId: string) => {
        e.stopPropagation();
        selectOverlaySegment(segmentId);
    }, [selectOverlaySegment]);

    if (!isActive || visibleSegments.length === 0) return null;

    /**
     * Transform an output-space rect through the zoom viewport to display coords.
     * Mirrors the canvas painter's ctx.scale(scaleX, scaleY) + ctx.translate(-vp.x, -vp.y)
     */
    const outputToViewportDisplay = (rect: Rect): Rect => {
        const scaleX = outputSize.width / viewport.width;
        const scaleY = outputSize.height / viewport.height;
        const projected: Rect = {
            x: (rect.x - viewport.x) * scaleX,
            y: (rect.y - viewport.y) * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY,
        };
        return displayMapper.outputToDisplay(projected);
    };

    const pointToViewportDisplay = (pt: { x: number; y: number }) => {
        const scaleX = outputSize.width / viewport.width;
        const scaleY = outputSize.height / viewport.height;
        const r = displayMapper.outputToDisplay({
            x: (pt.x - viewport.x) * scaleX,
            y: (pt.y - viewport.y) * scaleY,
            width: 0,
            height: 0,
        });
        return { x: r.x, y: r.y };
    };

    return (
        <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
            {visibleSegments.map((segment: OverlaySegment) => (
                <OverlayHoverTarget
                    key={segment.id}
                    segment={segment}
                    isHovered={hoveredSegmentId === segment.id}
                    onHover={(hovered) => setHoveredSegmentId(hovered ? segment.id : null)}
                    onClick={(e) => handleClick(e, segment.id)}
                    outputToViewportDisplay={outputToViewportDisplay}
                    pointToViewportDisplay={pointToViewportDisplay}
                />
            ))}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Hover target for a single overlay segment
// ─────────────────────────────────────────────────────────────

interface HoverTargetProps {
    segment: OverlaySegment;
    isHovered: boolean;
    onHover: (hovered: boolean) => void;
    onClick: (e: React.MouseEvent) => void;
    outputToViewportDisplay: (rect: Rect) => Rect;
    pointToViewportDisplay: (pt: { x: number; y: number }) => { x: number; y: number };
}

const OverlayHoverTarget: React.FC<HoverTargetProps> = ({
    segment, isHovered, onHover, onClick, outputToViewportDisplay, pointToViewportDisplay
}) => {
    const hoverBorder = isHovered ? '2px solid var(--color-secondary)' : '2px solid transparent';
    const item = segment.item;

    switch (item.type) {
        case 'blur':
        case 'border': {
            const rectItem = item as BlurOverlayItem | BorderOverlayItem;
            const display = outputToViewportDisplay(rectItem.rectPx);
            return (
                <div
                    style={{
                        position: 'absolute',
                        left: display.x,
                        top: display.y,
                        width: display.width,
                        height: display.height,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        border: hoverBorder,
                        borderRadius: 2,
                    }}
                    onMouseEnter={() => onHover(true)}
                    onMouseLeave={() => onHover(false)}
                    onClick={onClick}
                />
            );
        }
        case 'text': {
            const textItem = item as TextOverlayItem;
            // Estimate text height for hover target
            const outputSize = { height: 1080 }; // ref height for padding calc
            const scale = outputSize.height / 1080;
            const pad = Math.round(8 * scale);
            const lineHeightPx = textItem.fontSizePx * 1.2;
            // Simple line count estimation
            const estLines = Math.max(1, Math.ceil((textItem.text || '').length * textItem.fontSizePx * 0.6 / Math.max(textItem.widthPx, 1)));
            const totalOutputHeight = Math.max(lineHeightPx, estLines * lineHeightPx) + pad * 2;

            const display = outputToViewportDisplay({
                x: textItem.topLeft.x - pad,
                y: textItem.topLeft.y - pad,
                width: textItem.widthPx + pad * 2,
                height: totalOutputHeight,
            });
            return (
                <div
                    style={{
                        position: 'absolute',
                        left: display.x,
                        top: display.y,
                        width: display.width,
                        height: display.height,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        border: hoverBorder,
                        borderRadius: 2,
                    }}
                    onMouseEnter={() => onHover(true)}
                    onMouseLeave={() => onHover(false)}
                    onClick={onClick}
                />
            );
        }
        case 'arrow': {
            const arrowItem = item as ArrowOverlayItem;
            const tail = pointToViewportDisplay(arrowItem.tail);
            const head = pointToViewportDisplay(arrowItem.head);
            return (
                <svg
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                        zIndex: 10,
                    }}
                >
                    {/* Thick transparent hit area */}
                    <line
                        x1={tail.x} y1={tail.y}
                        x2={head.x} y2={head.y}
                        stroke="transparent"
                        strokeWidth={12}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onMouseEnter={() => onHover(true)}
                        onMouseLeave={() => onHover(false)}
                        onClick={onClick}
                    />
                    {/* Visible hover line */}
                    {isHovered && (
                        <line
                            x1={tail.x} y1={tail.y}
                            x2={head.x} y2={head.y}
                            stroke="var(--color-secondary)"
                            strokeWidth={2}
                            style={{ pointerEvents: 'none' }}
                        />
                    )}
                </svg>
            );
        }
        default:
            return null;
    }
};
