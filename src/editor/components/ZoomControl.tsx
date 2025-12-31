import React, { useRef, useEffect } from 'react';
import type { Rect, Size } from '../../core/types';

// Define interaction types
type InteractionType = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface ZoomControlProps {
    initialRect: Rect;
    videoSize: Size;
    containerFittedRect: Rect;
    onCommit: (rect: Rect) => void;
    onCancel: () => void;
    onDelete: () => void;
}

export const ZoomControl: React.FC<ZoomControlProps> = ({
    initialRect,
    videoSize,
    containerFittedRect,
    onCommit,
    onCancel,
    onDelete
}) => {
    const zoomBoxRef = useRef<HTMLDivElement>(null);
    const startDragRef = useRef<{ type: InteractionType, x: number, y: number, initialRect: Rect } | null>(null);

    // We update this Ref during drag. On PointerUp, we flush this to the store via onCommit.
    const currentDragRectRef = useRef<Rect>(initialRect);

    const handlePointerDown = (e: React.PointerEvent, type: InteractionType) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        startDragRef.current = {
            type,
            x: e.clientX,
            y: e.clientY,
            initialRect: { ...currentDragRectRef.current }
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!startDragRef.current || containerFittedRect.width === 0) return;

        const { type, initialRect, x: startX, y: startY } = startDragRef.current;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const scale = videoSize.width / containerFittedRect.width;

        const scaledDeltaX = deltaX * scale;
        const scaledDeltaY = deltaY * scale;

        const maxW = videoSize.width;
        const maxH = videoSize.height;
        const aspectRatio = maxW / maxH;

        let newRect = { ...initialRect };

        if (type === 'move') {
            // 1. Apply Move
            newRect.x += scaledDeltaX;
            newRect.y += scaledDeltaY;

            // 2. Clamp
            // X Bounds
            if (newRect.x < 0) newRect.x = 0;
            if (newRect.x + newRect.width > maxW) newRect.x = maxW - newRect.width;

            // Y Bounds
            if (newRect.y < 0) newRect.y = 0;
            if (newRect.y + newRect.height > maxH) newRect.y = maxH - newRect.height;

        } else {
            // RESIZING
            let proposedWidth = initialRect.width;

            if (type === 'se' || type === 'ne') {
                proposedWidth += scaledDeltaX;
            } else { // sw, nw
                proposedWidth -= scaledDeltaX;
            }

            if (proposedWidth < 100) proposedWidth = 100;

            // Anchor Points
            const bottom = initialRect.y + initialRect.height;
            const right = initialRect.x + initialRect.width;

            if (type === 'se') {
                const maxAvailableW = maxW - initialRect.x;
                const maxAvailableH_asW = (maxH - initialRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;

            } else if (type === 'sw') {
                const maxAvailableW = right;
                const maxAvailableH_asW = (maxH - initialRect.y) * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;

            } else if (type === 'ne') {
                const maxAvailableW = maxW - initialRect.x;
                const maxAvailableH_asW = bottom * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.y = bottom - newRect.height;

            } else if (type === 'nw') {
                const maxAvailableW = right;
                const maxAvailableH_asW = bottom * aspectRatio;
                proposedWidth = Math.min(proposedWidth, maxAvailableW, maxAvailableH_asW);

                newRect.width = proposedWidth;
                newRect.height = proposedWidth / aspectRatio;
                newRect.x = right - newRect.width;
                newRect.y = bottom - newRect.height;
            }
        }

        // UPDATE LOCAL REF ONLY
        currentDragRectRef.current = newRect;

        // DIRECT DOM UPDATE
        if (zoomBoxRef.current) {
            zoomBoxRef.current.style.left = `${(newRect.x / videoSize.width) * 100}%`;
            zoomBoxRef.current.style.top = `${(newRect.y / videoSize.height) * 100}%`;
            zoomBoxRef.current.style.width = `${(newRect.width / videoSize.width) * 100}%`;
            zoomBoxRef.current.style.height = `${(newRect.height / videoSize.height) * 100}%`;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (startDragRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit(currentDragRectRef.current);
            startDragRef.current = null;
        }
    };

    // Key Listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                onDelete();
            }
            if (e.key === 'Escape') {
                onCancel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onDelete, onCancel]);

    // Handle Component
    const Handle = ({ type, cursor }: { type: InteractionType, cursor: string }) => {
        const size = 12;
        let style: React.CSSProperties = {
            position: 'absolute',
            width: size,
            height: size,
            backgroundColor: '#fff',
            border: '1px solid #000',
            cursor: cursor,
            zIndex: 10
        };

        if (type === 'nw') { style.top = -size / 2; style.left = -size / 2; }
        if (type === 'ne') { style.top = -size / 2; style.right = -size / 2; }
        if (type === 'sw') { style.bottom = -size / 2; style.left = -size / 2; }
        if (type === 'se') { style.bottom = -size / 2; style.right = -size / 2; }

        return (
            <div
                style={style}
                onPointerDown={(e) => handlePointerDown(e, type)}
            />
        );
    };

    return (
        <div
            className="absolute z-50 overflow-hidden"
            style={{
                left: containerFittedRect.x,
                top: containerFittedRect.y,
                width: containerFittedRect.width,
                height: containerFittedRect.height,
            }}
            onClick={onCancel} // Click background to exit
        >
            <div
                ref={zoomBoxRef}
                className="absolute border-2 border-yellow-400 cursor-move"
                style={{
                    left: `${(initialRect.x / videoSize.width) * 100}%`,
                    top: `${(initialRect.y / videoSize.height) * 100}%`,
                    width: `${(initialRect.width / videoSize.width) * 100}%`,
                    height: `${(initialRect.height / videoSize.height) * 100}%`,
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
                }}
                onClick={(e) => {
                    e.stopPropagation();
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                <Handle type="nw" cursor="nw-resize" />
                <Handle type="ne" cursor="ne-resize" />
                <Handle type="sw" cursor="sw-resize" />
                <Handle type="se" cursor="se-resize" />

                <div className="absolute top-0 left-0 bg-yellow-400 text-black text-[10px] font-bold px-1 flex items-center gap-1">
                    <span>ZOOM</span>
                    <button
                        className="ml-1 hover:bg-yellow-600 px-1 rounded"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCancel();
                        }}
                    >
                        ✕
                    </button>
                </div>
            </div>
        </div>
    );
};
