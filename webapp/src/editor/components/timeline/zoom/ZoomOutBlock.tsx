import React from 'react';
import { AiOutlineZoomOut } from 'react-icons/ai';
import { zoomOutBlock, HOLD_HEIGHT } from './ZoomTrackStyles';
import { BLOCK_ICON_SIZE, MIN_ICON_WIDTH_PX } from '../TimelineBlockStyles';

interface ZoomOutBlockProps {
    /** Left position in pixels */
    left: number;
    /** Width of the zoom-out block in pixels */
    width: number;
    /** Track height for centering */
    trackHeight: number;
}

/**
 * Non-interactable indicator block showing the implicit zoom-out transition
 * that occurs in the gap after a zoom block ends.
 */
export const ZoomOutBlock: React.FC<ZoomOutBlockProps> = ({ left, width, trackHeight }) => {
    const segmentY = (trackHeight - HOLD_HEIGHT) / 2;

    return (
        <div
            className={zoomOutBlock.base}
            style={{
                left,
                top: segmentY,
                width,
                ...zoomOutBlock.getStyle(),
                zIndex: 2,
            }}
        >
            {width >= MIN_ICON_WIDTH_PX && (
                <AiOutlineZoomOut className="text-main opacity-50" size={BLOCK_ICON_SIZE} />
            )}
        </div>
    );
};
