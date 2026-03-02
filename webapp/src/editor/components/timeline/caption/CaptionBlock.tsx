import React, { useState, useRef, useEffect } from 'react';
import { FaRegClosedCaptioning } from 'react-icons/fa';
import { createPortal } from 'react-dom';
import {
    captionBlock,
    captionContainer,
    resizeHandle,
    dragHandleIndicator,
    DRAG_HANDLE_HEIGHT,
} from './CaptionTrackStyles';
import { blockIconClass, BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';

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
    /** Caption text to display in tooltip */
    text: string;
    /** Mouse down handler for move drag */
    onMouseDown: (e: React.MouseEvent) => void;
    /** Click handler for selection */
    onClick: (e: React.MouseEvent) => void;
    /** Mouse down handler for left resize */
    onResizeStartMouseDown: (e: React.MouseEvent) => void;
    /** Mouse down handler for right resize */
    onResizeEndMouseDown: (e: React.MouseEvent) => void;
    /** Whether the track is disabled (visual only, no interaction) */
    disabled?: boolean;
    /** Whether the track is in collapsed state (hides icons) */
    isCollapsed?: boolean;
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
    text,
    onMouseDown,
    onClick,
    onResizeStartMouseDown,
    onResizeEndMouseDown,
    disabled = false,
    isCollapsed = false,
}) => {
    const segmentHeight = trackHeight - 2;
    const blockY = 1;
    const colorClass = (isSelected && !disabled) ? captionBlock.selectedClass : captionBlock.defaultClass;
    const hoverClass = (isSelected || disabled) ? '' : captionBlock.hoverClass;

    // Tooltip hover state
    const [isHovered, setIsHovered] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setTooltipPos({
                left: rect.left + rect.width / 2,
                top: rect.top - 8,
            });
        }
    }, [isHovered]);

    return (
        <>
            <div
                ref={containerRef}
                className={`${captionContainer.base} group ${isDragging ? captionContainer.dragging : captionContainer.idle} ${(!isSelected && !disabled) ? captionContainer.hoverClass : ''} ${disabled ? 'pointer-events-none' : ''}`}
                style={{
                    left: `${left}px`,
                    width: `${width}px`,
                    height: trackHeight,
                    zIndex: isSelected ? 20 : isHovered ? 15 : 10,
                    opacity: disabled ? 0.7 : 1,
                    cursor: disabled ? 'default' : undefined,
                }}
                onMouseDown={disabled ? undefined : onMouseDown}
                onClick={disabled ? undefined : onClick}
                onMouseEnter={disabled ? undefined : () => setIsHovered(true)}
                onMouseLeave={disabled ? undefined : () => setIsHovered(false)}
            >
                {/* Caption Block */}
                <div
                    className={`${captionBlock.base} ${colorClass} ${hoverClass} flex items-center justify-center overflow-hidden`}
                    style={{
                        left: 0,
                        top: blockY,
                        width: '100%',
                        ...captionBlock.getStyle(),
                        height: segmentHeight,
                    }}
                >
                    {!isCollapsed && width >= MIN_ICON_WIDTH_PX && (
                        <FaRegClosedCaptioning className={blockIconClass} size={BLOCK_ICON_SIZE} />
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

            {/* Tooltip — portal-rendered to escape stacking contexts */}
            {isHovered && !isSelected && text && createPortal(
                <div
                    className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float text-xs text-text-main max-w-[280px] px-3 py-2 pointer-events-none"
                    style={{
                        left: tooltipPos.left,
                        top: tooltipPos.top,
                        transform: 'translate(-50%, -100%)',
                    }}
                >
                    {text}
                </div>,
                document.body
            )}
        </>
    );
};
