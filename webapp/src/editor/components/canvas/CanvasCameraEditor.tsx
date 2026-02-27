import React, { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CameraSettings, Rect, Project } from '../../../types';
import { BoundingBox, type CornerRadii } from './bounding-box';
import { DimmedOverlay } from '../../../components/DimmedOverlay';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { type RenderResources } from './PlaybackRenderer';
import { drawScreen } from '../../../core/painters/screenPainter';
import { drawWebcam } from '../../../core/painters/webcamPainter';
import { getViewportStateAtTime } from '../../../core/zoom';

// ------------------------------------------------------------------
// LOGIC: Render Strategy (for CameraEdit mode)
// No auto-shrink applied; zoom viewport is preserved.
// ------------------------------------------------------------------
export const renderCameraEditor = (
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

    const screenSource = project.screenSource;

    // Apply zoom viewport
    const effectiveViewport = getViewportStateAtTime(
        project.timeline.zoomSegments || [],
        currentTimeMs,
        outputSize,
        project.settings.zoom
    );

    // Render Screen Layer
    if (screenSource.id) {
        const video = videoRefs[screenSource.id];
        if (video) {
            drawScreen(
                ctx,
                video,
                project,
                effectiveViewport,
                resources.deviceFrameImg
            );
        }
    }

    // Render Camera Layer (no auto-shrink)
    const cameraSource = project.cameraSource;
    const cameraSettings = state.overrideCameraSettings || project.settings.camera;

    if (cameraSource && cameraSettings) {
        const video = videoRefs[cameraSource.id];
        if (video) {
            drawWebcam(ctx, video, cameraSource.size, cameraSettings);
        }
    }
};

// ------------------------------------------------------------------
// COMPONENT: Camera Editor Overlay
// ------------------------------------------------------------------

// Minimum size for camera overlay (in output pixels)
const MIN_CAMERA_SIZE = 100;

interface CameraEditorProps {
    cameraRef: React.MutableRefObject<CameraSettings | null>;
}

export const CameraEditor: React.FC<CameraEditorProps> = ({ cameraRef }) => {
    // ------------------------------------------------------------------
    // STORE CONNECTIONS (non-reactive for initial values)
    // ------------------------------------------------------------------
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const updateSettings = useProjectStore(s => s.updateSettings);

    // Get cameraSource reactively (for aspect ratio constraint)
    const cameraSource = useProjectStore(s => s.project.cameraSource);

    // Subscribe to shape reactively - this is a discrete enum, not a continuous value,
    // so it won't cause feedback loops like x/y/width/height would
    const currentShape = useProjectStore(s => s.project.settings.camera?.shape ?? 'rect');

    // Subscribe to non-positional settings that can change via sliders/toggles while editor is open
    // These won't cause feedback loops since the bounding box doesn't modify them
    const cropZoom = useProjectStore(s => s.project.settings.camera?.cropZoom);
    const autoShrink = useProjectStore(s => s.project.settings.camera?.autoShrink);
    const shrinkScale = useProjectStore(s => s.project.settings.camera?.shrinkScale);
    const borderRadius = useProjectStore(s => s.project.settings.camera?.borderRadiusPx);
    const borderWidth = useProjectStore(s => s.project.settings.camera?.borderWidthPx);
    const borderColor = useProjectStore(s => s.project.settings.camera?.borderColor);
    const hasShadow = useProjectStore(s => s.project.settings.camera?.hasShadow);
    const hasGlow = useProjectStore(s => s.project.settings.camera?.hasGlow);

    // Get spotlight dimOpacity for the dimmed overlay
    const dimOpacity = useProjectStore(s => s.project.settings.spotlight.dimOpacity);

    // Batcher for consistent history behavior
    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();

    // ------------------------------------------------------------------
    // INITIAL VALUE ONLY PATTERN
    // ------------------------------------------------------------------
    // Fetch initial settings ONCE using getState() - no reactive subscription.
    // This prevents the feedback loop: store → props → local state → store → ...\
    // All changes during interaction are local-only, committed to store on release.
    const initialSettingsRef = useRef<CameraSettings | null>(null);
    if (initialSettingsRef.current === null) {
        initialSettingsRef.current = useProjectStore.getState().project.settings.camera ?? null;
    }
    const initialSettings = initialSettingsRef.current;

    // Local state for the editor session
    const [currentSettings, setCurrentSettings] = React.useState<CameraSettings | null>(
        initialSettings ? { ...initialSettings } : null
    );

    const containerRef = useRef<HTMLDivElement>(null);

    // ------------------------------------------------------------------
    // EFFECTS
    // ------------------------------------------------------------------

    // Re-sync local state when non-positional settings change externally (from settings panel)
    // This ensures the live preview updates when changing sliders, shape, etc.
    // We merge fresh settings with current local position to avoid overwriting active drags
    useEffect(() => {
        const freshSettings = useProjectStore.getState().project.settings.camera;
        if (freshSettings && currentSettings) {
            // Merge: take position from local state, everything else from store
            const merged = {
                ...freshSettings,
                xPx: currentSettings.xPx,
                yPx: currentSettings.yPx,
                widthPx: currentSettings.widthPx,
                heightPx: currentSettings.heightPx,
            };
            // But if shape changed, take the new dimensions from store too
            if (freshSettings.shape !== currentSettings.shape) {
                merged.xPx = freshSettings.xPx;
                merged.yPx = freshSettings.yPx;
                merged.widthPx = freshSettings.widthPx;
                merged.heightPx = freshSettings.heightPx;
            }
            setCurrentSettings(merged);
            cameraRef.current = merged;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentShape, cropZoom, autoShrink, shrinkScale, borderRadius, borderWidth, borderColor, hasShadow, hasGlow, cameraRef]);

    // Initialize cameraRef on mount and cleanup on unmount
    useEffect(() => {
        if (initialSettings) {
            cameraRef.current = { ...initialSettings };
        }
        return () => {
            cameraRef.current = null;
        };
    }, [initialSettings, cameraRef]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setCanvasMode(CanvasMode.Preview);
                cameraRef.current = null;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setCanvasMode, cameraRef]);

    // ------------------------------------------------------------------
    // EARLY RETURN (after all hooks)
    // ------------------------------------------------------------------
    if (!initialSettings || !currentSettings) return null;

    // ------------------------------------------------------------------
    // DERIVED VALUES
    // ------------------------------------------------------------------

    // Only show corner radius handles for rect/square shapes (not circle)
    const showCornerEditing = currentShape !== 'circle';

    // Square and circle shapes maintain 1:1 aspect ratio
    const fixedAspectRatio = (currentShape === 'square' || currentShape === 'circle') ? 1 : null;

    // Get current border radius as CornerRadii array (all corners linked)
    const cornerRadii: CornerRadii = (() => {
        const r = currentSettings.borderRadiusPx ?? 0;
        return [r, r, r, r];
    })();

    // For circle shape, use half the size as radius for DimmedOverlay
    const dimmedOverlayRadii: CornerRadii = (() => {
        if (currentShape === 'circle') {
            // Circle is always square (widthPx === heightPx), use half as radius
            const circleRadius = currentSettings.widthPx / 2;
            return [circleRadius, circleRadius, circleRadius, circleRadius];
        }
        return cornerRadii;
    })();

    // Adapter: convert Px-suffixed CameraSettings to Rect for BoundingBox/DimmedOverlay
    const cameraRect: Rect = {
        x: currentSettings.xPx,
        y: currentSettings.yPx,
        width: currentSettings.widthPx,
        height: currentSettings.heightPx,
    };

    // ------------------------------------------------------------------
    // HANDLERS
    // ------------------------------------------------------------------

    const handleChange = (rect: Rect) => {
        const cameraShape = currentSettings.shape;
        const newSettings = {
            ...currentSettings,
            xPx: rect.x, yPx: rect.y, widthPx: rect.width, heightPx: rect.height,
            // Keep borderRadiusPx in sync for circles — painter renders purely on radius
            ...(cameraShape === 'circle' ? { borderRadiusPx: Math.min(rect.width, rect.height) / 2 } : {}),
        };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings; // Update canvas live preview
    };

    const onCommit = (rect: Rect) => {
        const cameraShape = currentSettings.shape;
        // Merge all local changes with rect and commit to store
        const newSettings: CameraSettings = {
            ...currentSettings,
            xPx: rect.x, yPx: rect.y, widthPx: rect.width, heightPx: rect.height,
            // Keep borderRadiusPx in sync for circles
            ...(cameraShape === 'circle' ? { borderRadiusPx: Math.min(rect.width, rect.height) / 2 } : {}),
        };
        batchAction(() => updateSettings({ camera: newSettings }));
        endInteraction();
        cameraRef.current = null;
    };

    const handleCornerRadiiChange = (radii: CornerRadii) => {
        // All corners are linked, so just take the first value
        const newRadius = radii[0];
        const newSettings = { ...currentSettings, borderRadiusPx: newRadius };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings; // Update canvas live preview
    };

    const handleCornerRadiiCommit = (radii: CornerRadii) => {
        const newRadius = radii[0];
        const newSettings: CameraSettings = {
            ...currentSettings,
            borderRadiusPx: newRadius
        };
        batchAction(() => updateSettings({ camera: newSettings }));
        endInteraction();
    };

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
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
                    // Corner radius editing (always linked, no toggle)
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
