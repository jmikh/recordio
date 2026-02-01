import React, { useState } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { legendItem } from './SpotlightTrackStyles';

/**
 * SpotlightLegend displays an info icon that shows a tooltip explaining
 * the spotlight track visual elements.
 */
export const SpotlightLegend: React.FC = () => {
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
                        {/* Fade In */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.fadeIn.className}
                                style={legendItem.fadeIn.style}
                            />
                            <span>Fade in</span>
                        </div>

                        {/* Hold */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.hold.className}
                                style={legendItem.hold.style}
                            />
                            <span>Hold</span>
                        </div>

                        {/* Fade Out */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className={legendItem.fadeOut.className}
                                style={legendItem.fadeOut.style}
                            />
                            <span>Fade out</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
