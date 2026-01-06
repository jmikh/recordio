import React, { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CameraSettings, Rect } from '../../../core/types';
import { BoundingBox } from './BoundingBox';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

// ------------------------------------------------------------------
// COMPONENT: Camera Editor Overlay
// ------------------------------------------------------------------

interface CameraEditorProps {
    cameraRef: React.MutableRefObject<CameraSettings | null>;
}

export const CameraEditor: React.FC<CameraEditorProps> = ({ cameraRef }) => {
    // Connect to Store
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const project = useProjectStore(s => s.project);

    // Batcher for consistent history behavior
    const { batchAction } = useHistoryBatcher();

    // Derived State
    const outputSize = project.settings.outputSize;
    // We use the settings from the store as the INITIAL state for the drag
    const initialSettings = project.settings.camera;

    if (!initialSettings) return null;

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

    const onCancel = () => {
        setCanvasMode(CanvasMode.Preview);
        cameraRef.current = null;
    };

    const containerRef = useRef<HTMLDivElement>(null);

    // Local Drag State (for calculations)
    // We also sync this to cameraRef.current for the canvas loop
    const [currentSettings, setCurrentSettings] = React.useState<CameraSettings>({ ...initialSettings });

    // Sync state on Mount/Update
    useEffect(() => {
        setCurrentSettings({ ...initialSettings });
        cameraRef.current = { ...initialSettings };
        return () => {
            cameraRef.current = null;
        };
    }, [initialSettings, cameraRef]);

    const handleChange = (rect: Rect) => {
        const newSettings = { ...currentSettings, ...rect };
        setCurrentSettings(newSettings);
        cameraRef.current = newSettings; // Update canvas live preview
    };

    // Close on Outside Click
    useClickOutside(containerRef, onCancel);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

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
                    canvasSize={outputSize}
                    maintainAspectRatio={true} // Camera always maintains aspect ratio
                    onChange={handleChange}
                    onCommit={onCommit}
                />
            </div>
        </div>
    );
};
