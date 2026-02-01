import React, { useState } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { legendItem } from './ZoomTrackStyles';

/**
 * ZoomLegend displays an info icon that shows a tooltip explaining
 * the zoom track visual elements.
 */
export const ZoomLegend: React.FC = () => {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className="relative"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <MdInfoOutline
                size={14}
                className="text-text-muted hover:text-text-highlighted cursor-pointer transition-colors"
            />

            {/* Tooltip */}
            {isHovered && (
                <div
                    className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-[9999] 
                               bg-surface-overlay border border-border rounded-md shadow-float
                               px-3 py-2 whitespace-nowrap"
                >
                    <div className="flex items-center gap-4 text-xs text-text-main">
                        {/* Zoomed Hold */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.holdLine.className}
                                style={legendItem.holdLine.style}
                            />
                            <span>Zoomed hold</span>
                        </div>

                        {/* Transition */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.transitionTrail.className}
                                style={legendItem.transitionTrail.style}
                            />
                            <span>Transition</span>
                        </div>

                        {/* Keyframe */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.diamond.className}
                                style={legendItem.diamond.style}
                            />
                            <span>Keyframe</span>
                        </div>

                        {/* Full viewport */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.square.className}
                                style={legendItem.square.style}
                            />
                            <span>Full viewport</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
