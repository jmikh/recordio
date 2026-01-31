import React, { useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CameraSettings, Rect } from '../../../core/types';
import { BoundingBox, type CornerRadii } from './BoundingBox';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

// ------------------------------------------------------------------
// COMPONENT: Camera Editor Overlay
// ------------------------------------------------------------------

// Minimum aspect ratio (width/height) - allows camera to be 2x taller than wide
const MIN_CAMERA_ASPECT_RATIO = 0.5;

interface CameraEditorProps {
    cameraRef: React.MutableRefObject<CameraSettings | null>;
}

export const CameraEditor: React.FC<CameraEditorProps> = ({ cameraRef }) => {
    // Connect to Store
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const project = useProjectStore(s => s.project);

    // Batcher for consistent history behavior
    const { batchAction, startInteraction } = useHistoryBatcher();

    // Derived State
    const cameraSource = project.cameraSource;
    // We use the settings from the store as the INITIAL state for the drag
    const initialSettings = project.settings.camera;

    // Calculate max aspect ratio from camera source (cannot be wider than the raw camera)
    const maxCameraAspectRatio = useMemo(() => {
        if (cameraSource && cameraSource.size.height > 0) {
            return cameraSource.size.width / cameraSource.size.height;
        }
        // Default to 16:9 if no camera source
        return 16 / 9;
    }, [cameraSource]);

    // Get current border radius as CornerRadii array (all corners linked to same value)
    // borderRadius is in output pixels
    const cornerRadii: CornerRadii = useMemo(() => {
        const r = initialSettings?.borderRadius ?? 0;
        return [r, r, r, r];
    }, [initialSettings?.borderRadius]);

    const containerRef = useRef<HTMLDivElement>(null);

    // Local Drag State (for calculations)
    // We also sync this to cameraRef.current for the canvas loop
    const [currentSettings, setCurrentSettings] = React.useState<CameraSettings | null>(
        initialSettings ? { ...initialSettings } : null
    );

    // Sync state on Mount/Update
    useEffect(() => {
        if (initialSettings) {
            setCurrentSettings({ ...initialSettings });
            cameraRef.current = { ...initialSettings };
        }
        return () => {
            cameraRef.current = null;
        };
    }, [initialSettings, cameraRef]);

    // Close on Outside Click
    useClickOutside(containerRef, () => {
        setCanvasMode(CanvasMode.Preview);
        cameraRef.current = null;
    });

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

    // Early return AFTER all hooks are declared (Rules of Hooks)
    if (!initialSettings || !currentSettings) return null;

    // Only show corner radius handles for rect/square shapes (not circle)
    const showCornerEditing = initialSettings.shape !== 'circle';

    // Actions
    const onCommit = (rect: Rect) => {
        // Convert Rect back to CameraSettings format (preserving other props)
        const newSettings: CameraSettings = {
            ...initialSettings,
            ...rect
        };
        batchAction(() => updateSettings({ camera: newSettings }));
        cameraRef.current = null;
    };

    const handleChange = (rect: Rect) => {
        const newSettings = { ...currentSettings, ...rect };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings; // Update canvas live preview
    };

    // Corner radius change handler - update the single borderRadius value
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
            ...initialSettings,
            ...currentSettings,
            borderRadius: newRadius
        };
        batchAction(() => updateSettings({ camera: newSettings }));
    };

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-50 pointer-events-none"
        >
            {/* Background Closer */}
            <div
                className="absolute inset-0 pointer-events-auto"
            />

            <div className="absolute inset-0 pointer-events-none">
                <BoundingBox
                    rect={currentSettings}
                    maintainAspectRatio={false}
                    minAspectRatio={MIN_CAMERA_ASPECT_RATIO}
                    maxAspectRatio={maxCameraAspectRatio}
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

