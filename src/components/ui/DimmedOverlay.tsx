import React from 'react';
import type { Rect } from '../../core/types';

interface DimmedOverlayProps {
    /** The rectangle to "cut out" (transparent hole) */
    holeRect: Rect;
    /** The total size of the container/canvas */
    containerSize: { width: number; height: number };
    /** Optional opacity for the dimmed background (default: 0.6) */
    opacity?: number;
    /** Optional overlay color (default: black) */
    color?: string;
    /** Border radius as percentage of the smaller dimension (0-50). 0 = rectangle, 50 = circle/pill */
    borderRadiusPercent?: number;
    /** Additional class names */
    className?: string;
    /** Optional children to render inside the overlay container */
    children?: React.ReactNode;
}

export const DimmedOverlay: React.FC<DimmedOverlayProps> = ({
    holeRect,
    containerSize,
    opacity = 0.6,
    color = 'black',
    borderRadiusPercent = 0,
    className = '',
    children
}) => {
    // Calculate border radius in actual units (relative to container)
    const smallerDimension = Math.min(holeRect.width, holeRect.height);
    const borderRadiusPx = (borderRadiusPercent / 100) * (smallerDimension / 2);

    // Use SVG mask for rounded rectangles
    // This approach creates an SVG mask where:
    // - White = visible (dimmed area)
    // - Black = transparent (the hole)

    const bgStyle = color === 'black' ? `rgba(0, 0, 0, ${opacity})` : color;

    // Generate unique ID for the mask
    const maskId = `dimmed-mask-${React.useId().replace(/:/g, '')}`;

    return (
        <div
            className={`absolute inset-0 pointer-events-none ${className}`}
            style={{
                backgroundColor: bgStyle,
                opacity: color !== 'black' ? opacity : undefined,
                // Use CSS mask to cut out the hole
                maskImage: `url(#${maskId})`,
                WebkitMaskImage: `url(#${maskId})`,
            }}
        >
            {/* SVG Definition for the mask */}
            <svg
                width="100%"
                height="100%"
                style={{ position: 'absolute', width: '100%', height: '100%' }}
            >
                <defs>
                    <mask id={maskId}>
                        {/* White background = visible */}
                        <rect x="0" y="0" width="100%" height="100%" fill="white" />
                        {/* Black hole = transparent */}
                        <rect
                            x={`${(holeRect.x / containerSize.width) * 100}%`}
                            y={`${(holeRect.y / containerSize.height) * 100}%`}
                            width={`${(holeRect.width / containerSize.width) * 100}%`}
                            height={`${(holeRect.height / containerSize.height) * 100}%`}
                            rx={borderRadiusPx}
                            ry={borderRadiusPx}
                            fill="black"
                        />
                    </mask>
                </defs>
                {/* Apply the mask to a full-size rect */}
                <rect
                    x="0"
                    y="0"
                    width="100%"
                    height="100%"
                    fill={bgStyle}
                    mask={`url(#${maskId})`}
                />
            </svg>
            {children}
        </div>
    );
};
