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
    className = '',
    children
}) => {
    // Convert to percentages for CSS positioning
    const toPct = (val: number, ref: number) => (val / ref) * 100;

    const leftPct = toPct(holeRect.x, containerSize.width);
    const topPct = toPct(holeRect.y, containerSize.height);
    const widthPct = toPct(holeRect.width, containerSize.width);
    const heightPct = toPct(holeRect.height, containerSize.height);

    // We use a polygon clip-path to create a "hole" in the fill.
    // The path goes:
    // 1. Clockwise around the outer edge (0,0 -> 0,100 -> 100,100 -> 100,0 -> 0,0)
    // 2. Then cuts IN to the hole start (left, top)
    // 3. Counter-clockwise around the hole
    // 4. Back out to the start (0,0)
    // 
    // This effectively fills everything *except* the hole.

    const polygon = `polygon(
        0% 0%, 
        0% 100%, 
        100% 100%, 
        100% 0%, 
        0% 0%, 
        ${leftPct}% ${topPct}%, 
        ${leftPct + widthPct}% ${topPct}%, 
        ${leftPct + widthPct}% ${topPct + heightPct}%, 
        ${leftPct}% ${topPct + heightPct}%, 
        ${leftPct}% ${topPct}%
    )`;

    // Convert opacity to alpha channel for background color if it's a simple color, 
    // or just use opacity style. 
    // If color is 'black' (default), we can use rgba(0,0,0, opacity).

    // Simple implementation: use opacity on the div itself, but that affects children if we had any.
    // But since this is an overlay, usually we want the "fill" to be semi-transparent.
    // The clip-path cuts the shape.

    const bgStyle = color === 'black' ? `rgba(0, 0, 0, ${opacity})` : color;

    return (
        <div
            className={`absolute inset-0 pointer-events-none ${className}`}
            style={{
                backgroundColor: bgStyle,
                clipPath: polygon,
                // If the user passed a non-black color string that doesn't have alpha, 
                // we might need to apply opacity via CSS. 
                // But generally rgba/tailwind classes are better.
                // For 'black' default we handled it above.
                opacity: color !== 'black' ? opacity : undefined
            }}
        >
            {children}
        </div>
    );
};
