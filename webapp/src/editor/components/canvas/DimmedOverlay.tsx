import React from 'react';
import type { Rect } from '@shared/types';
import type { CornerRadii } from '@shared/mappers/displayMapper';
import { useDisplayMapper } from '../../hooks/useDisplayMapper';

interface DimmedOverlayProps {
    /** The rectangle to "cut out" (transparent hole) - in output coordinates */
    holeRect: Rect;
    /** Optional opacity for the dimmed background (default: 0.6) */
    opacity?: number;
    /** Optional overlay color (default: black) */
    color?: string;
    /** Per-corner border radius [tl, tr, br, bl] in output pixels. Default: [0,0,0,0] */
    cornerRadii?: CornerRadii;
    /** Feathered edge width in output pixels, fading outward from the hole (0 = hard edge) */
    featherPx?: number;
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
    featherPx = 0,
    className = '',
    children
}) => {
    const displayMapper = useDisplayMapper();
    const bgStyle = color === 'black' ? `rgba(0, 0, 0, ${opacity})` : color;

    // Generate unique IDs for the mask and feather filter
    const id = React.useId().replace(/:/g, '');
    const maskId = `dimmed-mask-${id}`;
    const featherId = `dimmed-feather-${id}`;

    // Check if we have any radius
    const hasRadius = cornerRadii.some(r => r > 0);

    // Get SVG viewBox from DisplayMapper (uses output coordinates)
    const viewBox = displayMapper.getSvgViewBox();
    const { outputSize } = displayMapper;

    // Hole shape grown outward by `grow` px (radii grow with it, as in spotlightPainter)
    const holeShape = (grow: number, props: React.SVGProps<SVGPathElement & SVGRectElement>) => {
        const rect = {
            x: holeRect.x - grow,
            y: holeRect.y - grow,
            width: holeRect.width + grow * 2,
            height: holeRect.height + grow * 2,
        };
        return hasRadius ? (
            // Use path for rounded corners (output coordinates)
            <path
                d={displayMapper.createRoundedRectPath(rect, cornerRadii.map(r => r + grow) as CornerRadii)}
                {...props}
            />
        ) : (
            // Simple rect when no radius
            <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} {...props} />
        );
    };

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
                    {featherPx > 0 && (
                        <filter
                            id={featherId}
                            filterUnits="userSpaceOnUse"
                            x="0"
                            y="0"
                            width={outputSize.width}
                            height={outputSize.height}
                        >
                            <feGaussianBlur stdDeviation={featherPx / 4} />
                        </filter>
                    )}
                    <mask id={maskId}>
                        {/* White background = visible */}
                        <rect x="0" y="0" width={outputSize.width} height={outputSize.height} fill="white" />
                        {/* Outward-only feather, matching spotlightPainter: a blurred hole grown by
                            half the feather fades out across featherPx beyond the hole edge... */}
                        {featherPx > 0 && holeShape(featherPx / 2, { fill: 'black', filter: `url(#${featherId})` })}
                        {/* ...and the hole itself stays fully transparent */}
                        {holeShape(0, { fill: 'black' })}
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
