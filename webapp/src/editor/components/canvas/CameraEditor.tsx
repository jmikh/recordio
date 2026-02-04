import React, { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CameraSettings, Rect } from '../../../types';
import { BoundingBox, type CornerRadii } from './bounding-box';
import { useClickOutside } from '../../hooks/useClickOutside';
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

    // Batcher for consistent history behavior
    const { batchAction, startInteraction } = useHistoryBatcher();

    // ------------------------------------------------------------------
    // INITIAL VALUE ONLY PATTERN
    // ------------------------------------------------------------------
    // Fetch initial settings ONCE using getState() - no reactive subscription.
    // This prevents the feedback loop: store → props → local state → store → ...
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

    // Initialize cameraRef on mount and cleanup on unmount
    useEffect(() => {
        if (initialSettings) {
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

    // ------------------------------------------------------------------
    // EARLY RETURN (after all hooks)
    // ------------------------------------------------------------------
    if (!initialSettings || !currentSettings) return null;

    // ------------------------------------------------------------------
    // DERIVED VALUES
    // ------------------------------------------------------------------

    // Only show corner radius handles for rect/square shapes (not circle)
    const showCornerEditing = initialSettings.shape !== 'circle';

    // Square and circle shapes maintain 1:1 aspect ratio
    const fixedAspectRatio = (initialSettings.shape === 'square' || initialSettings.shape === 'circle') ? 1 : null;

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
            {/* Background Closer */}
            <div
                className="absolute inset-0 pointer-events-auto"
            />

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
