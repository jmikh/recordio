import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'bottom-center' | 'top-right' | 'right';

type InfoTooltipSize = 'medium' | 'small';

const TOOLTIP_SIZES: Record<InfoTooltipSize, { container: number; media: number; px: string; py: string }> = {
    medium: { container: 500, media: 480, px: 'px-5', py: 'py-3' },
    small: { container: 375, media: 360, px: 'px-4', py: 'py-2.5' },
};

interface InfoTooltipProps {
    /** Description text explaining the feature */
    description: string;
    /** Optional path to the demo video */
    videoSrc?: string;
    /** Optional path to the demo image */
    imageSrc?: string;
    /** Tooltip size variant. Default: 'medium' */
    size?: InfoTooltipSize;
    /** Tooltip placement relative to trigger. Default: 'bottom-center' */
    placement?: TooltipPlacement;
    /** Custom trigger element. Defaults to the info "ⓘ" icon */
    trigger?: ReactNode;
    /** Optional additional content to render below the description */
    children?: ReactNode;
}

/** Compute tooltip position from trigger rect based on placement */
function getTooltipPosition(rect: DOMRect, placement: TooltipPlacement) {
    switch (placement) {
        case 'top-right':
            return { left: rect.right + 8, top: rect.top, transform: 'translateY(-100%)' };
        case 'right':
            return { left: rect.right + 8, top: rect.top, transform: undefined };
        case 'bottom-center':
        default:
            return { left: rect.left + rect.width / 2, top: rect.bottom + 8, transform: 'translateX(-50%)' };
    }
}

/**
 * InfoTooltip provides a consistent tooltip experience for feature explanations.
 * Features:
 * - Configurable trigger element (defaults to info icon)
 * - Configurable placement (bottom-center, top-right, right)
 * - Portal-rendered tooltip (escapes stacking contexts)
 * - Optional video/image media
 * - Description text
 * - Optional children for additional content
 */
export const InfoTooltip: React.FC<InfoTooltipProps> = ({
    description, videoSrc, imageSrc, size = 'medium', placement = 'bottom-center', trigger, children
}) => {
    const dims = TOOLTIP_SIZES[size];
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
                className="relative flex items-center justify-center cursor-pointer"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {trigger ?? (
                    <MdInfoOutline
                        className="icon-sm text-text-muted hover:text-text-highlighted transition-colors"
                    />
                )}
            </div>

            {/* Tooltip - rendered via portal to escape stacking contexts */}
            {isHovered &&
                createPortal(
                    <div
                        className={`fixed z-[999999] bg-surface-raised border border-border rounded-md shadow-float overflow-hidden text-xs text-text-main ${(videoSrc || imageSrc)
                            ? `${dims.px} ${dims.py} flex flex-col items-center`
                            : 'max-w-[280px]'
                            }`}
                        style={{
                            ...((videoSrc || imageSrc) ? { width: dims.container } : {}),
                            left: position.left,
                            top: position.top,
                            ...(position.transform ? { transform: position.transform } : {}),
                        }}

                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    >
                        {/* Demo Video */}
                        {videoSrc && (
                            <video
                                src={videoSrc}
                                autoPlay
                                loop
                                muted
                                playsInline
                                width={dims.media}
                                className="rounded"
                                style={{ width: dims.media, minWidth: dims.media, maxWidth: dims.media }}
                            />
                        )}

                        {/* Demo Image */}
                        {imageSrc && (
                            <img
                                src={imageSrc}
                                alt=""
                                width={dims.media}
                                className="rounded"
                                style={{ width: dims.media, minWidth: dims.media, maxWidth: dims.media }}
                            />
                        )}

                        {/* Description text */}
                        <div className={(videoSrc || imageSrc) ? 'mt-2 text-center whitespace-pre-line' : 'px-3 py-2'}>
                            {description}
                        </div>

                        {/* Optional children */}
                        {children}
                    </div>,
                    document.body
                )}
        </>
    );
};
