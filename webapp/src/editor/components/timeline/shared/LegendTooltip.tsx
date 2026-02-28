import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { createPortal } from 'react-dom';

interface LegendTooltipProps {
    /** Path to the demo video */
    videoSrc: string;
    /** Description text explaining the feature */
    description: string;
    /** Legend items to display below the video */
    children: ReactNode;
}

/**
 * LegendTooltip provides a consistent tooltip experience for track legends.
 * Features:
 * - Info icon trigger
 * - Portal-rendered tooltip (escapes stacking contexts)
 * - Fixed 480px video that doesn't shrink
 * - Description text under video
 * - Centered legend items below video
 * - Maximum z-index for overlay priority
 */
export const LegendTooltip: React.FC<LegendTooltipProps> = ({ videoSrc, description, children }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const iconRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && iconRef.current) {
            const rect = iconRef.current.getBoundingClientRect();
            setPosition({
                left: rect.right + 8, // 8px margin from icon
                top: rect.top,
            });
        }
    }, [isHovered]);

    return (
        <>
            <div
                ref={iconRef}
                className="relative"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <MdInfoOutline
                    size={14}
                    className="text-text-muted hover:text-text-highlighted cursor-pointer transition-colors"
                />
            </div>

            {/* Tooltip - rendered via portal to escape stacking contexts */}
            {isHovered &&
                createPortal(
                    <div
                        className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float px-5 py-3 w-[500px] flex flex-col items-center"
                        style={{ left: position.left, top: position.top }}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    >
                        {/* Demo Video - fixed 480px width, never shrinks */}
                        <video
                            src={videoSrc}
                            autoPlay
                            loop
                            muted
                            playsInline
                            width={480}
                            className="rounded"
                            style={{ width: 480, minWidth: 480, maxWidth: 480 }}
                        />

                        {/* Description text */}
                        <p className="text-xs text-text-muted mt-2 mb-6 text-center max-w-[480px] whitespace-pre-line">
                            {description}
                        </p>

                        {/* Legend items - centered, no text wrapping, extra horizontal spacing */}
                        <div className="flex items-center justify-center gap-6 text-xs text-text-main whitespace-nowrap">
                            {children}
                        </div>
                    </div >,
                    document.body
                )}
        </>
    );
};

interface LegendItemProps {
    /** The visual indicator element (colored div, shape, etc.) */
    indicator: ReactNode;
    /** Label text for the legend item */
    label: string;
}

/**
 * LegendItem displays a single legend entry with an indicator and label.
 */
export const LegendItem: React.FC<LegendItemProps> = ({ indicator, label }) => {
    return (
        <div className="flex items-center gap-1.5">
            {indicator}
            <span>{label}</span>
        </div>
    );
};
