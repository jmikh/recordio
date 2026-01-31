import React from 'react';
import type { Rect } from '../../core/types';
import type { CornerRadii } from '../../core/mappers/displayMapper';
import { useDisplayMapper } from '../../editor/hooks/useDisplayMapper';

interface DimmedOverlayProps {
    /** The rectangle to "cut out" (transparent hole) - in output coordinates */
    holeRect: Rect;
    /** Optional opacity for the dimmed background (default: 0.6) */
    opacity?: number;
    /** Optional overlay color (default: black) */
    color?: string;
    /** Per-corner border radius [tl, tr, br, bl] in output pixels. Default: [0,0,0,0] */
    cornerRadii?: CornerRadii;
    /** Additional class names */
    className?: string;
    /** Optional children to render inside the overlay container */
    children?: React.ReactNode;
}

export const DimmedOverlay: React.FC<DimmedOverlayProps> = ({
    holeRect,
    opacity = 0.6,
    color = 'black',
    cornerRadii = [0, 0, 0, 0],
    className = '',
    children
}) => {
    const displayMapper = useDisplayMapper();
    const bgStyle = color === 'black' ? `rgba(0, 0, 0, ${opacity})` : color;

    // Generate unique ID for the mask
    const maskId = `dimmed-mask-${React.useId().replace(/:/g, '')}`;

    // Check if we have any radius
    const hasRadius = cornerRadii.some(r => r > 0);

    // Get SVG viewBox from DisplayMapper (uses output coordinates)
    const viewBox = displayMapper.getSvgViewBox();
    const { outputSize } = displayMapper;

    return (
        <div className={`absolute inset-0 pointer-events-none ${className}`}>
            {/* SVG handles the entire dimmed overlay with cutout hole */}
            <svg
                width="100%"
                height="100%"
                viewBox={viewBox}
                preserveAspectRatio="none"
                style={{ position: 'absolute', width: '100%', height: '100%' }}
            >
                <defs>
                    <mask id={maskId}>
                        {/* White background = visible */}
                        <rect x="0" y="0" width={outputSize.width} height={outputSize.height} fill="white" />
                        {/* Black hole = transparent */}
                        {hasRadius ? (
                            // Use path for rounded corners (output coordinates)
                            <path
                                d={displayMapper.createRoundedRectPath(holeRect, cornerRadii)}
                                fill="black"
                            />
                        ) : (
                            // Simple rect when no radius
                            <rect
                                x={holeRect.x}
                                y={holeRect.y}
                                width={holeRect.width}
                                height={holeRect.height}
                                fill="black"
                            />
                        )}
                    </mask>
                </defs>
                {/* Dimmed background with cutout hole via mask */}
                <rect
                    x="0"
                    y="0"
                    width={outputSize.width}
                    height={outputSize.height}
                    fill={bgStyle}
                    mask={`url(#${maskId})`}
                />
            </svg>
            {children}
        </div>
    );
};
