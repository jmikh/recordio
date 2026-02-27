import React, { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import type { CameraSettings, CameraLayoutSegment, Rect, Project } from '../../../types';
import { BoundingBox, type CornerRadii } from './bounding-box';
import { DimmedOverlay } from '../../../components/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { type RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { getViewportStateAtTime } from '../../../core/zoom';

// ------------------------------------------------------------------
// LOGIC: Render Strategy (for CameraLayoutEdit mode)
// Same as CameraEdit: no auto-shrink, zoom viewport preserved.
// ------------------------------------------------------------------
export const renderCameraLayoutEditor = (
    resources: RenderResources,
    state: {
        project: Project,
        currentTimeMs: number,
        overrideCameraSettings: CameraSettings | null
    }
) => {
    const { ctx, videoRefs } = resources;
    const { project, currentTimeMs } = state;
    const outputSize = project.settings.outputSize;

    const effectiveViewport = getViewportStateAtTime(
        project.timeline.zoomSegments || [],
        currentTimeMs,
        outputSize,
        project.settings.zoom
    );

    // Render Screen Layer
    const screenSource = project.screenSource;
    if (screenSource.id) {
        const video = videoRefs[screenSource.id];
        if (video) {
            drawScreen(ctx, video, project, effectiveViewport, resources.deviceFrameImg);
        }
    }

    // Render Camera Layer — only if override settings exist (null means hidden)
    const cameraSource = project.cameraSource;
    const cameraSettings = state.overrideCameraSettings;

    if (cameraSource && cameraSettings) {
        const video = videoRefs[cameraSource.id];
        if (video) {
            drawWebcam(ctx, video, cameraSource.size, cameraSettings);
        }
    }
};

// ------------------------------------------------------------------
// COMPONENT: Camera Layout Editor Overlay
// ------------------------------------------------------------------

const MIN_CAMERA_SIZE = 100;

export const CameraLayoutEditor: React.FC<{
    cameraRef: React.MutableRefObject<CameraSettings | null>;
}> = ({ cameraRef }) => {
    const selectCameraLayout = useUIStore(s => s.selectCameraLayout);
    const updateCameraLayout = useProjectStore(s => s.updateCameraLayout);
    const selectedCameraLayoutId = useUIStore(s => s.selectedCameraLayoutId);

    // Get the selected segment
    const segment = useProjectStore(s => {
        const segs = s.project.timeline.cameraLayoutSegments || [];
        return segs.find((seg: CameraLayoutSegment) => seg.id === selectedCameraLayoutId) ?? null;
    });

    // Get camera source for aspect ratio
    const cameraSource = useProjectStore(s => s.project.cameraSource);

    // Get global camera settings as a base to merge with layout overrides
    const globalCameraSettings = useProjectStore(s => s.project.settings.camera);

    // Subscribe to segment properties that change via inspector (non-positional)
    const segmentShape = segment?.shape ?? 'rect';
    const segmentBorderRadius = segment?.borderRadiusPx ?? 0;
    const segmentHidden = segment?.hidden ?? false;

    // Spotlight dim opacity for overlay
    const dimOpacity = useProjectStore(s => s.project.settings.spotlight.dimOpacity);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();

    // Build effective camera settings from the segment
    // Bake borderRadiusPx for circles since the painter renders purely on radius
    const buildEffectiveSettings = (seg: CameraLayoutSegment): CameraSettings => ({
        ...(globalCameraSettings as CameraSettings),
        xPx: seg.xPx,
        yPx: seg.yPx,
        widthPx: seg.widthPx,
        heightPx: seg.heightPx,
        shape: seg.shape,
        borderRadiusPx: seg.shape === 'circle'
            ? Math.min(seg.widthPx, seg.heightPx) / 2
            : seg.borderRadiusPx,
    });

    // Local state for the editor session
    const [currentSettings, setCurrentSettings] = React.useState<CameraSettings | null>(() => {
        if (!segment) return null;
        return buildEffectiveSettings(segment);
    });

    const containerRef = useRef<HTMLDivElement>(null);

    // Re-sync when non-positional settings change externally (from inspector)
    useEffect(() => {
        if (segment && currentSettings) {
            const merged = {
                ...buildEffectiveSettings(segment),
                xPx: currentSettings.xPx,
                yPx: currentSettings.yPx,
                widthPx: currentSettings.widthPx,
                heightPx: currentSettings.heightPx,
            };
            if (segment.shape !== currentSettings.shape) {
                merged.xPx = segment.xPx;
                merged.yPx = segment.yPx;
                merged.widthPx = segment.widthPx;
                merged.heightPx = segment.heightPx;
            }
            setCurrentSettings(merged);
            cameraRef.current = merged;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segmentShape, segmentBorderRadius, cameraRef]);

    // When hidden, clear cameraRef so webcam isn't drawn on canvas
    useEffect(() => {
        if (segmentHidden) {
            cameraRef.current = null;
        } else if (segment && currentSettings) {
            cameraRef.current = currentSettings;
        }
    }, [segmentHidden, segment, currentSettings, cameraRef]);

    // Initialize cameraRef on mount and cleanup on unmount
    useEffect(() => {
        if (segment) {
            const settings = buildEffectiveSettings(segment);
            cameraRef.current = settings;
        }
        return () => {
            cameraRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                selectCameraLayout(null);
                cameraRef.current = null;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectCameraLayout, cameraRef]);

    if (!segment || !currentSettings) return null;

    // Hidden block: nothing to show on canvas
    if (segmentHidden) return null;

    // Derived values
    const showCornerEditing = segmentShape !== 'circle';
    const fixedAspectRatio = (segmentShape === 'square' || segmentShape === 'circle') ? 1 : null;

    const cornerRadii: CornerRadii = (() => {
        const r = currentSettings.borderRadiusPx ?? 0;
        return [r, r, r, r];
    })();

    const dimmedOverlayRadii: CornerRadii = (() => {
        if (segmentShape === 'circle') {
            const circleRadius = currentSettings.widthPx / 2;
            return [circleRadius, circleRadius, circleRadius, circleRadius];
        }
        return cornerRadii;
    })();

    const cameraRect: Rect = {
        x: currentSettings.xPx,
        y: currentSettings.yPx,
        width: currentSettings.widthPx,
        height: currentSettings.heightPx,
    };

    // Handlers — write to the segment, not global settings
    const handleChange = (rect: Rect) => {
        const newSettings = {
            ...currentSettings,
            xPx: rect.x, yPx: rect.y, widthPx: rect.width, heightPx: rect.height,
            // Keep borderRadiusPx in sync for circles — painter renders purely on radius
            ...(segmentShape === 'circle' ? { borderRadiusPx: Math.min(rect.width, rect.height) / 2 } : {}),
        };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings;
    };

    const onCommit = (rect: Rect) => {
        batchAction(() => updateCameraLayout(segment.id, {
            xPx: rect.x,
            yPx: rect.y,
            widthPx: rect.width,
            heightPx: rect.height,
            // Keep borderRadiusPx in sync for circles
            ...(segmentShape === 'circle' ? { borderRadiusPx: Math.min(rect.width, rect.height) / 2 } : {}),
        }));
        endInteraction();
        // Keep cameraRef alive — user may continue editing
    };

    const handleCornerRadiiChange = (radii: CornerRadii) => {
        const newRadius = radii[0];
        const newSettings = { ...currentSettings, borderRadiusPx: newRadius };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings;
    };

    const handleCornerRadiiCommit = (radii: CornerRadii) => {
        const newRadius = radii[0];
        batchAction(() => updateCameraLayout(segment.id, { borderRadiusPx: newRadius }));
        endInteraction();
    };

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-[var(--z-index-modal)] pointer-events-none"
        >
            <DimmedOverlay
                holeRect={cameraRect}
                cornerRadii={dimmedOverlayRadii}
                opacity={dimOpacity}
            />

            <div className="absolute inset-0 pointer-events-none">
                <BoundingBox
                    rect={cameraRect}
                    minSize={MIN_CAMERA_SIZE}
                    fixedAspectRatio={fixedAspectRatio}
                    onChange={handleChange}
                    onCommit={onCommit}
                    onDragStart={startInteraction}
                    allowCornerEditing={showCornerEditing}
                    cornerRadii={cornerRadii}
                    cornersLinked={true}
                    hideLinkToggle={true}
                    onCornerRadiiChange={handleCornerRadiiChange}
                    onCornerRadiiCommit={handleCornerRadiiCommit}
                />
            </div>
        </div>
    );
};
