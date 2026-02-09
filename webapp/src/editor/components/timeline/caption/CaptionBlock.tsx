import React from 'react';
import {
    captionBlock,
    captionContainer,
    resizeHandle,
    dragHandleIndicator,
    CAPTION_BLOCK_HEIGHT,
    DRAG_HANDLE_HEIGHT,
} from './CaptionTrackStyles';

interface CaptionBlockProps {
    /** Left position in pixels */
    left: number;
    /** Total width of the caption block in pixels */
    width: number;
    /** Whether this caption is selected */
    isSelected: boolean;
    /** Whether this caption is being dragged */
    isDragging: boolean;
    /** Track height for centering */
    trackHeight: number;
    /** Mouse down handler for move drag */
    onMouseDown: (e: React.MouseEvent) => void;
    /** Click handler for selection */
    onClick: (e: React.MouseEvent) => void;
    /** Mouse down handler for left resize */
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    /** Mouse down handler for right resize */
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Renders a caption block on the timeline — a single solid block with
 * near-black background and primary border, containing truncated text.
 */
export const CaptionBlock: React.FC<CaptionBlockProps> = ({
    left,
    width,
    isSelected,
    isDragging,
    trackHeight,
    onMouseDown,
    onClick,
    onResizeStartMouseDown,
    onResizeEndMouseDown,
}) => {
    const blockY = (trackHeight - CAPTION_BLOCK_HEIGHT) / 2;
    const colorClass = isSelected ? captionBlock.selectedClass : captionBlock.defaultClass;
    const hoverClass = isSelected ? '' : captionBlock.hoverClass;

    return (
        <div
            className={`${captionContainer.base} group ${isDragging ? captionContainer.dragging : captionContainer.idle}`}
            style={{
                left: `${left}px`,
                width: `${width}px`,
                height: trackHeight,
                zIndex: isSelected ? 20 : 10,
            }}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            {/* Caption Block */}
            <div
                className={`${captionBlock.base} ${colorClass} ${hoverClass}`}
                style={{
                    left: 0,
                    top: blockY,
                    width: '100%',
                    ...captionBlock.getStyle(),
                }}
            >
                {width >= 20 && (
                    <span className="text-[9px]  font-bold text-text-on-primary select-none pointer-events-none mx-auto">C</span>
                )}
            </div>

            {/* Left resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    left: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: (trackHeight - DRAG_HANDLE_HEIGHT) / 2,
                    height: resizeHandle.height,
                }}
                onMouseDown={onResizeStartMouseDown}
            >
                <div
                    className={`${dragHandleIndicator.base} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: dragHandleIndicator.height }}
                />
            </div>

            {/* Right resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    right: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: (trackHeight - DRAG_HANDLE_HEIGHT) / 2,
                    height: resizeHandle.height,
                }}
                onMouseDown={onResizeEndMouseDown}
            >
                <div
                    className={`${dragHandleIndicator.base} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: dragHandleIndicator.height }}
                />
            </div>
        </div>
    );
};
