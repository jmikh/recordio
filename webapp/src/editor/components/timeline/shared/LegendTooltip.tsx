import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { createPortal } from 'react-dom';
import type { TooltipPlacement } from '@shared/components/InfoTooltip';

interface LegendTooltipProps {
    /** Path to the demo video */
    videoSrc: string;
    /** Description text explaining the feature */
    description: string;
    /** Tooltip placement relative to trigger. Default: 'right' */
    placement?: TooltipPlacement;
    /** Custom trigger element. Defaults to the info "ⓘ" icon */
    trigger?: ReactNode;
    /** Legend items to display below the video */
    children: ReactNode;
}

/** Compute tooltip position from trigger rect based on placement */
function getTooltipPosition(rect: DOMRect, placement: TooltipPlacement) {
    switch (placement) {
        case 'top-right':
            return { left: rect.right + 8, top: rect.top, transform: 'translateY(-100%)' };
        case 'bottom-center':
            return { left: rect.left + rect.width / 2, top: rect.bottom + 8, transform: 'translateX(-50%)' };
        case 'right':
        default:
            return { left: rect.right + 8, top: rect.top, transform: undefined };
    }
}

/**
 * LegendTooltip provides a consistent tooltip experience for track legends.
 * Features:
 * - Configurable trigger element (defaults to info icon)
 * - Configurable placement (right, top-right, bottom-center)
 * - Portal-rendered tooltip (escapes stacking contexts)
 * - Fixed 480px video
 * - Description text under video
 * - Centered legend items below video
 */
export const LegendTooltip: React.FC<LegendTooltipProps> = ({
    videoSrc, description, placement = 'right', trigger, children
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0, transform: undefined as string | undefined });
    const triggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setPosition(getTooltipPosition(rect, placement));
        }
    }, [isHovered, placement]);

    return (
        <>
            <div
                ref={triggerRef}
                className="relative"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {trigger ?? (
                    <MdInfoOutline
                        size={14}
                        className="text-text-muted hover:text-text-highlighted cursor-pointer transition-colors"
                    />
                )}
            </div>

            {/* Tooltip - rendered via portal to escape stacking contexts */}
            {isHovered &&
                createPortal(
                    <div
                        className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float px-5 py-3 w-[500px] flex flex-col items-center"
                        style={{
                            left: position.left,
                            top: position.top,
                            ...(position.transform ? { transform: position.transform } : {}),
                        }}
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
