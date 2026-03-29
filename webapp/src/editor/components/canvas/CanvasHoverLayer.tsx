/**
 * CanvasHoverLayer
 *
 * Unified always-mounted layer that provides hover highlight + click-to-select
 * for interactive canvas elements while paused:
 *
 *   1. Camera  — higher priority; hover suppresses overlay targets
 *   2. Overlays — only active when camera is not hovered
 *
 * Accounts for the current zoom viewport when positioning targets.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';
import { getViewportStateAtTime } from '../../../core/zoom';
import { getResolvedCameraStateAtTime } from '../../../core/zoom/cameraAnimator';
import type { OverlaySegment, BlurOverlayItem, BorderOverlayItem, ArrowOverlayItem, TextOverlayItem } from '../../../types/overlay';
import type { Rect } from '../../../types';

// ─────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────

export const CanvasHoverLayer: React.FC = () => {
    const isPlaying    = useUIStore(s => s.isPlaying);
    const canvasMode   = useUIStore(s => s.canvasMode);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);

    const project      = useProjectStore(s => s.project);
    const outputSize   = project.settings.outputSize;
    const displayMapper = useDisplayMapper();

    const [hoveredCameraId, setHoveredCameraId] = useState<boolean>(false);
    const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);

    // ── Store actions ────────────────────────────────────────
    const selectCameraMove = useUIStore(s => s.selectCameraMove);
    const setCanvasMode    = useUIStore(s => s.setCanvasMode);
    const selectOverlaySegment = useUIStore(s => s.selectOverlaySegment);
    const selectedOverlayId = useUIStore(s => s.selectedOverlaySegmentId);

    // Clear lingering hover state if camera or segment disappears while hovered
    // (e.g. during timeline scrub or playback)
    const cameraActiveRef = useRef<boolean>(false);
    
    // We will evaluate the effects lower down after we calculate visibility.

    // ── Shared: zoom viewport ────────────────────────────────
    const zoomEnabled = project.settings.zoom?.enabled ?? true;
    const viewport = useMemo(() => {
        // If an overlay is selected, the entire canvas renders without zoom
        if (canvasMode === CanvasMode.OverlayEdit) {
            return { x: 0, y: 0, width: outputSize.width, height: outputSize.height };
        }
        
        const zoomSegments = zoomEnabled ? (project.timeline.zoomSegments || []) : [];
        return getViewportStateAtTime(zoomSegments, currentTimeMs, outputSize, project.settings.zoom);
    }, [canvasMode, zoomEnabled, project.timeline.zoomSegments, currentTimeMs, outputSize, project.settings.zoom]);

    /**
     * Transform an output-space rect through the zoom viewport to display coords.
     * Mirrors the canvas painter ctx.scale(scaleX, scaleY) + ctx.translate(-vp.x, -vp.y).
     */
    const outputToViewportDisplay = useCallback((rect: Rect): Rect => {
        const scaleX = outputSize.width / viewport.width;
        const scaleY = outputSize.height / viewport.height;
        const projected: Rect = {
            x: (rect.x - viewport.x) * scaleX,
            y: (rect.y - viewport.y) * scaleY,
            width: rect.width * scaleX,
            height: rect.height * scaleY,
        };
        return displayMapper.outputToDisplay(projected);
    }, [outputSize, viewport, displayMapper]);

    const pointToViewportDisplay = useCallback((pt: { x: number; y: number }) => {
        const scaleX = outputSize.width / viewport.width;
        const scaleY = outputSize.height / viewport.height;
        const r = displayMapper.outputToDisplay({
            x: (pt.x - viewport.x) * scaleX,
            y: (pt.y - viewport.y) * scaleY,
            width: 0,
            height: 0,
        });
        return { x: r.x, y: r.y };
    }, [outputSize, viewport, displayMapper]);

    // ── Camera hover target ──────────────────────────────────
    const cameraSource   = project.cameraSource;
    const cameraSettings = project.settings.camera;
    const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;

    const cameraActive =
        !isPlaying &&
        canvasMode !== CanvasMode.CameraEdit &&
        canvasMode !== CanvasMode.CameraMoveEdit &&
        canvasMode !== CanvasMode.OverlayEdit &&
        !!cameraSource &&
        !!cameraSettings;

    const resolvedCamera = useMemo(() => {
        if (!cameraActive || !cameraSettings) return null;
        return getResolvedCameraStateAtTime(
            cameraSettings,
            cameraMoveEnabled ? (project.timeline.cameraMoveSegments || []) : [],
            zoomEnabled ? (project.timeline.zoomSegments || []) : [],
            currentTimeMs,
            outputSize,
            project.settings.zoom
        );
    }, [
        cameraActive, cameraSettings, cameraMoveEnabled,
        project.timeline.cameraMoveSegments, project.timeline.zoomSegments,
        currentTimeMs, outputSize, project.settings.zoom, zoomEnabled
    ]);

    const cameraDisplayRect = useMemo(() => {
        if (!resolvedCamera || resolvedCamera.opacity <= 0) return null;
        return displayMapper.outputToDisplay({
            x: resolvedCamera.xPx,
            y: resolvedCamera.yPx,
            width: resolvedCamera.widthPx,
            height: resolvedCamera.heightPx,
        });
    }, [resolvedCamera, displayMapper]);

    const handleCameraClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        // Find a cameraMoveSegment covering currentTimeMs
        const segments = cameraMoveEnabled ? (project.timeline.cameraMoveSegments || []) : [];
        const active = segments.find(
            s => s.visible !== false &&
                currentTimeMs >= s.outputStartTimeMs &&
                currentTimeMs <= s.outputEndTimeMs
        );
        if (active) {
            selectCameraMove(active.id);
        } else {
            setCanvasMode(CanvasMode.CameraEdit);
        }
    }, [cameraMoveEnabled, project.timeline.cameraMoveSegments, currentTimeMs, selectCameraMove, setCanvasMode]);

    // ── Overlay hover targets ────────────────────────────────
    const overlayEnabled = project.settings.overlay?.enabled ?? true;

    const overlaysActive =
        !isPlaying &&
        canvasMode !== CanvasMode.ZoomEdit &&
        canvasMode !== CanvasMode.SpotlightEdit &&
        overlayEnabled;

    const visibleSegments = useMemo(() => {
        if (!overlaysActive) return [];
        return (project.timeline.overlaySegments || []).filter((s: OverlaySegment) =>
            s.visible &&
            s.id !== selectedOverlayId &&
            currentTimeMs >= s.outputStartTimeMs &&
            currentTimeMs <= s.outputEndTimeMs
        );
    }, [overlaysActive, project.timeline.overlaySegments, currentTimeMs, selectedOverlayId]);

    const handleOverlayClick = useCallback((e: React.MouseEvent, segmentId: string) => {
        e.stopPropagation();
        selectOverlaySegment(segmentId);
    }, [selectOverlaySegment]);

    if (!displayMapper) return null;

    const showCamera  = cameraActive && !!cameraDisplayRect;
    const showOverlays = overlaysActive && visibleSegments.length > 0;

    // --- Cleanup lingering state ---
    // If the camera goes out of view or is paused out, clear its hover state.
    useEffect(() => {
        if (!showCamera && hoveredCameraId) {
            setHoveredCameraId(false);
        }
    }, [showCamera, hoveredCameraId]);

    // If the hovered segment goes out of view, clear its hover state.
    useEffect(() => {
        if (hoveredSegmentId && !visibleSegments.find(s => s.id === hoveredSegmentId)) {
            setHoveredSegmentId(null);
        }
    }, [visibleSegments, hoveredSegmentId]);

    if (!showCamera && !showOverlays) return null;

    return (
        <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">

            {/* ── Overlay targets (suppressed while camera is hovered) ── */}
            {showOverlays && visibleSegments.map((segment: OverlaySegment) => (
                <OverlayHoverTarget
                    key={segment.id}
                    segment={segment}
                    isHovered={hoveredSegmentId === segment.id}
                    suppressPointerEvents={hoveredCameraId}
                    onHover={(hovered) => setHoveredSegmentId(hovered ? segment.id : null)}
                    onClick={(e) => handleOverlayClick(e, segment.id)}
                    outputToViewportDisplay={outputToViewportDisplay}
                    pointToViewportDisplay={pointToViewportDisplay}
                />
            ))}

            {/* ── Camera target ── */}
            {showCamera && cameraDisplayRect && (
                <div
                    style={{
                        position: 'absolute',
                        left: cameraDisplayRect.x,
                        top: cameraDisplayRect.y,
                        width: cameraDisplayRect.width,
                        height: cameraDisplayRect.height,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        border: hoveredCameraId
                            ? '2px solid var(--color-secondary)'
                            : '2px solid transparent',
                        borderRadius: resolvedCamera
                            ? Math.min(resolvedCamera.borderRadiusPx * (cameraDisplayRect.width / resolvedCamera.widthPx), cameraDisplayRect.width / 2)
                            : 2,
                        boxSizing: 'border-box',
                    }}
                    onMouseEnter={() => setHoveredCameraId(true)}
                    onMouseLeave={() => setHoveredCameraId(false)}
                    onClick={handleCameraClick}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Overlay hover target (per-segment)
// ─────────────────────────────────────────────────────────────

interface OverlayHoverTargetProps {
    segment: OverlaySegment;
    isHovered: boolean;
    suppressPointerEvents: boolean;
    onHover: (hovered: boolean) => void;
    onClick: (e: React.MouseEvent) => void;
    outputToViewportDisplay: (rect: Rect) => Rect;
    pointToViewportDisplay: (pt: { x: number; y: number }) => { x: number; y: number };
}

const OverlayHoverTarget: React.FC<OverlayHoverTargetProps> = ({
    segment, isHovered, suppressPointerEvents, onHover, onClick,
    outputToViewportDisplay, pointToViewportDisplay,
}) => {
    const hoverBorder = isHovered ? '2px solid var(--color-secondary)' : '2px solid transparent';
    const pointerEvents = suppressPointerEvents ? 'none' : 'auto';
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
                        pointerEvents,
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
            const scale = 1; // ref height ratio 1:1 for padding calc
            const pad = Math.round(8 * scale);
            const lineHeightPx = textItem.fontSizePx * 1.2;
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
                        pointerEvents,
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
                        style={{ pointerEvents: suppressPointerEvents ? 'none' : 'stroke', cursor: 'pointer' }}
                        onMouseEnter={() => onHover(true)}
                        onMouseLeave={() => onHover(false)}
                        onClick={onClick}
                    />
                    {/* Visible hover line */}
                    {isHovered && !suppressPointerEvents && (
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
