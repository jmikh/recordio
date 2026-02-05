import React, { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CameraSettings, Rect } from '../../../types';
import { BoundingBox, type CornerRadii } from './bounding-box';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

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
    const borderRadius = useProjectStore(s => s.project.settings.camera?.borderRadius);
    const borderWidth = useProjectStore(s => s.project.settings.camera?.borderWidth);
    const borderColor = useProjectStore(s => s.project.settings.camera?.borderColor);
    const hasShadow = useProjectStore(s => s.project.settings.camera?.hasShadow);
    const hasGlow = useProjectStore(s => s.project.settings.camera?.hasGlow);

    // Batcher for consistent history behavior
    const { batchAction, startInteraction } = useHistoryBatcher();

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
                x: currentSettings.x,
                y: currentSettings.y,
                width: currentSettings.width,
                height: currentSettings.height,
            };
            // But if shape changed, take the new dimensions from store too
            if (freshSettings.shape !== currentSettings.shape) {
                merged.x = freshSettings.x;
                merged.y = freshSettings.y;
                merged.width = freshSettings.width;
                merged.height = freshSettings.height;
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
        const r = currentSettings.borderRadius ?? 0;
        return [r, r, r, r];
    })();

    // ------------------------------------------------------------------
    // HANDLERS
    // ------------------------------------------------------------------

    const handleChange = (rect: Rect) => {
        console.log('[CameraEditor] handleChange', { w: rect.width.toFixed(0), h: rect.height.toFixed(0) });
        const newSettings = { ...currentSettings, ...rect };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings; // Update canvas live preview
    };

    const onCommit = (rect: Rect) => {
        console.log('[CameraEditor] onCommit', { w: rect.width.toFixed(0), h: rect.height.toFixed(0) });
        // Merge all local changes with rect and commit to store
        const newSettings: CameraSettings = {
            ...currentSettings,
            ...rect
        };
        batchAction(() => updateSettings({ camera: newSettings }));
        cameraRef.current = null;
    };

    const handleCornerRadiiChange = (radii: CornerRadii) => {
        // All corners are linked, so just take the first value
        const newRadius = radii[0];
        const newSettings = { ...currentSettings, borderRadius: newRadius };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings; // Update canvas live preview
    };

    const handleCornerRadiiCommit = (radii: CornerRadii) => {
        const newRadius = radii[0];
        const newSettings: CameraSettings = {
            ...currentSettings,
            borderRadius: newRadius
        };
        batchAction(() => updateSettings({ camera: newSettings }));
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
                    rect={currentSettings}
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
