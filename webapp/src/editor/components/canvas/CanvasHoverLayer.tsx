/**
 * CanvasHoverLayer
 *
 * Unified always-mounted layer that provides hover highlight + press-to-select
 * for interactive canvas elements while paused. The press is handed to the
 * item's BoundingBox (dragHandoff), so select + drag is one gesture:
 *
 *   1. Camera — higher priority; hover suppresses blur targets
 *   2. Blur regions — only active when camera is not hovered
 *
 * Accounts for the current zoom viewport when positioning targets.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';
import { getViewportStateAtTime } from '@shared/animators/zoomAnimator';
import { getResolvedCameraStateAtTime } from '@shared/animators/cameraAnimator';
import { getActiveBlurSegment } from '@shared/painters/blurPainter';
import type { BlurRegion, Rect } from '@shared/types';
import { beginDragHandoff } from './bounding-box/dragHandoff';

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
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);

    // ── Store actions ────────────────────────────────────────
    const selectCameraMove = useUIStore(s => s.selectCameraMove);
    const setCanvasMode    = useUIStore(s => s.setCanvasMode);
    const selectBlurSegment = useUIStore(s => s.selectBlurSegment);
    const setSettingsPanelActiveTab = useUIStore(s => s.setSettingsPanelActiveTab);

    // Clear lingering hover state if camera or segment disappears while hovered
    // (e.g. during timeline scrub or playback)
    const cameraActiveRef = useRef<boolean>(false);
    
    // We will evaluate the effects lower down after we calculate visibility.

    // ── Shared: zoom viewport ────────────────────────────────
    const zoomEnabled = project.settings.zoom?.enabled ?? true;
    const viewport = useMemo(() => {
        // While a blur segment is being edited, the entire canvas renders without zoom
        if (canvasMode === CanvasMode.BlurEdit) {
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

    // ── Camera hover target ──────────────────────────────────
    const cameraSource   = project.cameraSource;
    const cameraSettings = project.settings.camera;
    const cameraMoveEnabled = project.settings.cameraMove?.enabled ?? true;

    const cameraActive =
        !isPlaying &&
        canvasMode !== CanvasMode.CameraEdit &&
        canvasMode !== CanvasMode.CameraMoveEdit &&
        canvasMode !== CanvasMode.BlurEdit &&
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

    const handleCameraPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        beginDragHandoff(e);
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
            setSettingsPanelActiveTab('camera');
        }
    }, [cameraMoveEnabled, project.timeline.cameraMoveSegments, currentTimeMs, selectCameraMove, setCanvasMode, setSettingsPanelActiveTab]);

    // ── Blur region hover targets ────────────────────────────
    const blurEnabled = project.settings.blur?.enabled ?? true;

    const blurActive =
        !isPlaying &&
        canvasMode !== CanvasMode.ZoomEdit &&
        canvasMode !== CanvasMode.SpotlightEdit &&
        canvasMode !== CanvasMode.BlurEdit &&
        blurEnabled;

    const activeBlurSegment = useMemo(() => {
        if (!blurActive) return undefined;
        return getActiveBlurSegment(project.timeline.blurSegments || [], currentTimeMs);
    }, [blurActive, project.timeline.blurSegments, currentTimeMs]);
    const visibleRegions = useMemo(() => activeBlurSegment?.regions ?? [], [activeBlurSegment]);

    const handleRegionPointerDown = useCallback((e: React.PointerEvent, regionId: string) => {
        if (e.button !== 0 || !activeBlurSegment) return;
        e.stopPropagation();
        e.preventDefault();
        beginDragHandoff(e);
        selectBlurSegment(activeBlurSegment.id, regionId);
    }, [activeBlurSegment, selectBlurSegment]);

    if (!displayMapper) return null;

    const showCamera  = cameraActive && !!cameraDisplayRect;
    const showBlurs = visibleRegions.length > 0;

    // The cutout has no edge of its own, so it gets only the dashed frame
    const cameraIsCutout = (resolvedCamera?.cutoutAmount ?? 0) > 0 && !!cameraSource?.matte;
    const showCameraSolidOutline = hoveredCameraId && !cameraIsCutout;
    const showCameraDashedFrame = hoveredCameraId && (cameraIsCutout || (resolvedCamera?.borderRadiusPx ?? 0) > 0);

    // --- Cleanup lingering state ---
    // If the camera goes out of view or is paused out, clear its hover state.
    useEffect(() => {
        if (!showCamera && hoveredCameraId) {
            setHoveredCameraId(false);
        }
    }, [showCamera, hoveredCameraId]);

    // If the hovered region goes out of view, clear its hover state.
    useEffect(() => {
        if (hoveredRegionId && !visibleRegions.find(r => r.id === hoveredRegionId)) {
            setHoveredRegionId(null);
        }
    }, [visibleRegions, hoveredRegionId]);

    if (!showCamera && !showBlurs) return null;

    return (
        <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">

            {/* ── Blur region targets (suppressed while camera is hovered) ── */}
            {showBlurs && visibleRegions.map((region: BlurRegion) => (
                <BlurRegionHoverTarget
                    key={region.id}
                    region={region}
                    isHovered={hoveredRegionId === region.id}
                    suppressPointerEvents={hoveredCameraId}
                    onHover={(hovered) => setHoveredRegionId(hovered ? region.id : null)}
                    onPointerDown={(e) => handleRegionPointerDown(e, region.id)}
                    outputToViewportDisplay={outputToViewportDisplay}
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
                        border: showCameraSolidOutline
                            ? '2px solid var(--color-secondary)'
                            : '2px solid transparent',
                        borderRadius: resolvedCamera
                            ? Math.min(resolvedCamera.borderRadiusPx * (cameraDisplayRect.width / resolvedCamera.widthPx), cameraDisplayRect.width / 2)
                            : 2,
                        boxSizing: 'border-box',
                    }}
                    onMouseEnter={() => setHoveredCameraId(true)}
                    onMouseLeave={() => setHoveredCameraId(false)}
                    onPointerDown={handleCameraPointerDown}
                >
                    {/* Dashed square frame around a rounded or cutout camera, matching the selected BoundingBox */}
                    {showCameraDashedFrame && (
                        <div className="absolute -inset-0.5 border border-dashed border-secondary pointer-events-none" />
                    )}
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Blur region hover target
// ─────────────────────────────────────────────────────────────

interface BlurRegionHoverTargetProps {
    region: BlurRegion;
    isHovered: boolean;
    suppressPointerEvents: boolean;
    onHover: (hovered: boolean) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    outputToViewportDisplay: (rect: Rect) => Rect;
}

const BlurRegionHoverTarget: React.FC<BlurRegionHoverTargetProps> = ({
    region, isHovered, suppressPointerEvents, onHover, onPointerDown, outputToViewportDisplay,
}) => {
    const display = outputToViewportDisplay(region.rectPx);
    return (
        <div
            style={{
                position: 'absolute',
                left: display.x,
                top: display.y,
                width: display.width,
                height: display.height,
                pointerEvents: suppressPointerEvents ? 'none' : 'auto',
                cursor: 'pointer',
                border: isHovered ? '2px solid var(--color-secondary)' : '2px solid transparent',
                borderRadius: 2,
            }}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            onPointerDown={onPointerDown}
        />
    );
};
