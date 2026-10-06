import React, { useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CameraSettings, Rect, Project } from '@shared/types';
import { BoundingBox, type CornerRadii } from './bounding-box';

import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { type RenderResources } from '@shared/export/PlaybackRenderer';
import { drawScreen } from '@shared/painters/screenPainter';
import { drawCamera } from '@shared/painters/cameraPainter';
import { resolveCameraImage } from '@shared/painters/cameraCutout';
import { drawBlurs } from '@shared/painters/blurPainter';
import { getViewportStateAtTime } from '@shared/animators/zoomAnimator';

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
    const zoomEnabled = project.settings.zoom.enabled ?? true;
    const effectiveViewport = getViewportStateAtTime(
        zoomEnabled ? (project.timeline.zoomSegments || []) : [],
        currentTimeMs,
        outputSize,
        project.settings.zoom
    );

    // Render Screen Layer
    if (screenSource.storagePath) {
        const video = videoRefs[screenSource.storagePath];
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

    // Render blur regions
    if (project.settings.blur?.enabled ?? true) {
        drawBlurs(ctx, project.timeline.blurSegments || [], currentTimeMs, outputSize, effectiveViewport);
    }

    // Render Camera Layer (no auto-shrink)
    const cameraSource = project.cameraSource;
    const cameraSettings = state.overrideCameraSettings || project.settings.camera;

    if (cameraSource && cameraSettings) {
        const camera = resolveCameraImage(project, videoRefs, cameraSettings.removeBackground ? 1 : 0);
        if (camera) {
            drawCamera(ctx, camera, cameraSource.size, cameraSettings);
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

    // Subscribe to the whole camera settings so any change from the settings panel while the
    // editor is open (remove background, mirror, sliders...) re-syncs local state. No feedback
    // loop: the bounding box only writes to the store on release, and the re-sync keeps the
    // local position.
    const storeCamera = useProjectStore(useShallow(s => s.project.settings.camera));


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

    // Re-sync local state when settings change externally (from settings panel)
    // This ensures the live preview updates when changing sliders, shape, toggles, etc.
    // We merge fresh settings with current local position to avoid overwriting active drags
    useEffect(() => {
        const freshSettings = storeCamera;
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
    }, [storeCamera, cameraRef]);

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



    // Adapter: convert Px-suffixed CameraSettings to Rect for BoundingBox
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

    // Commit only the fields the bounding box owns, on top of fresh store settings — writing
    // the whole local copy could clobber settings changed in the panel since the editor opened
    const commitCamera = (patch: Partial<CameraSettings>) => {
        const freshSettings = useProjectStore.getState().project.settings.camera;
        if (!freshSettings) return;
        batchAction(() => updateSettings({ camera: { ...freshSettings, ...patch } }));
    };

    const onCommit = (rect: Rect) => {
        const cameraShape = currentSettings.shape;
        commitCamera({
            xPx: rect.x, yPx: rect.y, widthPx: rect.width, heightPx: rect.height,
            // Keep borderRadiusPx in sync for circles
            ...(cameraShape === 'circle' ? { borderRadiusPx: Math.min(rect.width, rect.height) / 2 } : {}),
        });
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
        commitCamera({ borderRadiusPx: newRadius });
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
