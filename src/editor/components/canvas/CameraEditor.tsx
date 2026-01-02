import { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import type { CameraSettings } from '../../../core/types';

// ------------------------------------------------------------------
// COMPONENT: Camera Editor Overlay
// ------------------------------------------------------------------
type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface CameraEditorProps {
    cameraRef: React.MutableRefObject<CameraSettings | null>;
}

export const CameraEditor: React.FC<CameraEditorProps> = ({ cameraRef }) => {
    // Connect to Store
    const setEditingCamera = useProjectStore(s => s.setEditingCamera);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const project = useProjectStore(s => s.project);

    // Derived State
    const outputSize = project.settings.outputSize;
    // We use the settings from the store as the INITIAL state for the drag
    const initialSettings = project.settings.camera;

    if (!initialSettings) return null;

    // Actions
    const onCommit = (newSettings: CameraSettings) => {
        updateSettings({ camera: newSettings });
        // Clear the override ref so the canvas uses the store settings again
        cameraRef.current = null;
    };

    const onCancel = () => {
        setEditingCamera(false);
        cameraRef.current = null;
    };

    const containerRef = useRef<HTMLDivElement>(null);
    const editorBoxRef = useRef<HTMLDivElement>(null);
    const startDragRef = useRef<{ type: InteractionType, x: number, y: number, initialSettings: CameraSettings } | null>(null);

    // Local Drag State (for calculations)
    // We also sync this to cameraRef.current for the canvas loop
    const currentSettingsRef = useRef<CameraSettings>({ ...initialSettings });

    // Sync Ref on Mount/Update
    useEffect(() => {
        currentSettingsRef.current = { ...initialSettings };
        // We do NOT set cameraRef.current here yet, only during drag? 
        // Actually, if we are editing, we might want the canvas to read from the ref immediately 
        // if we want to support "live" updates from some other source, but for now 
        // let's only set the cameraRef during active manipulation to override the static store value.
        // OR: We can set it to the initial value so the canvas always reads the ref while editing.
        cameraRef.current = { ...initialSettings };

        return () => {
            cameraRef.current = null;
        };
    }, [initialSettings, cameraRef]);

    const handlePointerDown = (e: React.PointerEvent, type: InteractionType) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        startDragRef.current = {
            type,
            x: e.clientX,
            y: e.clientY,
            initialSettings: { ...currentSettingsRef.current }
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!startDragRef.current || !containerRef.current) return;

        const currentWidth = containerRef.current.offsetWidth;
        if (currentWidth === 0) return;

        const { type, initialSettings: startSettings, x: startX, y: startY } = startDragRef.current;

        // Calculate Scale (Screen to Canvas)
        const scale = outputSize.width / currentWidth;
        const deltaX = (e.clientX - startX) * scale;
        const deltaY = (e.clientY - startY) * scale;

        let newSettings = { ...startSettings };

        if (type === 'move') {
            newSettings.x += deltaX;
            newSettings.y += deltaY;

            // Constrain to canvas bounds
            newSettings.x = Math.max(0, Math.min(newSettings.x, outputSize.width - newSettings.width));
            newSettings.y = Math.max(0, Math.min(newSettings.y, outputSize.height - newSettings.height));
        } else {
            // RESIZING with Aspect Ratio maintenance
            const isSquare = startSettings.shape === 'square' || startSettings.shape === 'circle';
            const aspectRatio = isSquare ? 1 : startSettings.width / startSettings.height;

            let proposedWidth = startSettings.width;

            if (type === 'se' || type === 'ne') {
                proposedWidth += deltaX;
            } else { // sw, nw
                proposedWidth -= deltaX;
            }

            // Min Width Constraint
            if (proposedWidth < 50) proposedWidth = 50;

            // Calculate Height
            const proposedHeight = proposedWidth / aspectRatio;

            newSettings.width = proposedWidth;
            newSettings.height = proposedHeight;

            // Anchor logic
            if (type === 'sw') {
                newSettings.x = (startSettings.x + startSettings.width) - proposedWidth;
            } else if (type === 'nw') {
                newSettings.x = (startSettings.x + startSettings.width) - proposedWidth;
                newSettings.y = (startSettings.y + startSettings.height) - proposedHeight;
            } else if (type === 'ne') {
                newSettings.y = (startSettings.y + startSettings.height) - proposedHeight;
            }
        }

        // Update Refs
        currentSettingsRef.current = newSettings;
        cameraRef.current = newSettings; // This Updates the Canvas (Imperatively)

        // Update DOM (Imperatively)
        if (editorBoxRef.current) {
            editorBoxRef.current.style.left = `${(newSettings.x / outputSize.width) * 100}%`;
            editorBoxRef.current.style.top = `${(newSettings.y / outputSize.height) * 100}%`;
            editorBoxRef.current.style.width = `${(newSettings.width / outputSize.width) * 100}%`;
            editorBoxRef.current.style.height = `${(newSettings.height / outputSize.height) * 100}%`;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (startDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit(currentSettingsRef.current);
            startDragRef.current = null;
        }
    };

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);


    // Handle Component (L-Shape style)
    const Handle = ({ type, cursor }: { type: InteractionType, cursor: string }) => {
        const size = 20;
        const thickness = 4;
        const length = 12;

        const containerStyle: React.CSSProperties = {
            position: 'absolute',
            width: size,
            height: size,
            cursor: cursor,
            zIndex: 10
        };

        const cornerStyle: React.CSSProperties = {
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderColor: '#fff',
            borderStyle: 'solid',
            borderWidth: 0,
            boxShadow: '0 0 2px rgba(0,0,0,0.5)' // Shadow for visibility
        };

        const isNorth = type.includes('n');
        const isWest = type.includes('w');

        // Positioning (Negative offsets to hang outside the box slightly)
        const offset = -thickness / 2;

        if (isNorth) {
            containerStyle.top = offset;
            cornerStyle.top = 0;
            cornerStyle.borderTopWidth = thickness;
        } else {
            containerStyle.bottom = offset;
            cornerStyle.bottom = 0;
            cornerStyle.borderBottomWidth = thickness;
        }

        if (isWest) {
            containerStyle.left = offset;
            cornerStyle.left = 0;
            cornerStyle.borderLeftWidth = thickness;
        } else {
            containerStyle.right = offset;
            cornerStyle.right = 0;
            cornerStyle.borderRightWidth = thickness;
        }

        cornerStyle.width = length;
        cornerStyle.height = length;

        // Alignment of the L-shape corner within the handle container
        if (!isWest) cornerStyle.right = 0;
        if (!isNorth) cornerStyle.bottom = 0;

        return (
            <div
                style={containerStyle}
                onPointerDown={(e) => handlePointerDown(e, type)}
            >
                <div style={cornerStyle} />
            </div>
        );
    };

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 w-full h-full z-50 pointer-events-none"
        >
            {/* Background Closer */}
            <div
                className="absolute inset-0 pointer-events-auto"
                onPointerDown={(e) => {
                    if (e.target === e.currentTarget) onCancel();
                }}
            />

            <div
                ref={editorBoxRef}
                className="absolute pointer-events-auto cursor-move"
                style={{
                    left: `${(initialSettings.x / outputSize.width) * 100}%`,
                    top: `${(initialSettings.y / outputSize.height) * 100}%`,
                    width: `${(initialSettings.width / outputSize.width) * 100}%`,
                    height: `${(initialSettings.height / outputSize.height) * 100}%`,
                    border: '2px solid rgba(255, 255, 255, 0.5)',
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                <Handle type="nw" cursor="nw-resize" />
                <Handle type="ne" cursor="ne-resize" />
                <Handle type="sw" cursor="sw-resize" />
                <Handle type="se" cursor="se-resize" />
            </div>
        </div>
    );
};
