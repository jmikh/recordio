import React, { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type TooltipPosition = 'top' | 'bottom-start';

interface TooltipProps {
    /** Text to display in the tooltip */
    text: string;
    /** The element to wrap with a tooltip */
    children: ReactNode;
    /** Optional className for the wrapper element */
    className?: string;
    /** Tooltip placement. 'top' auto-flips to bottom when clipped. */
    position?: TooltipPosition;
}

const VIEWPORT_PADDING = 8;

/**
 * Generic tooltip wrapper. Wraps any element and shows a portal-rendered
 * tooltip on hover, using the same pattern as InfoTooltip.
 * Clamps to viewport edges so content never goes off-screen.
 */
export const Tooltip: React.FC<TooltipProps> = ({ text, children, className, position: placement = 'top' }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0, flipped: false });
    const ref = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            if (placement === 'bottom-start') {
                setPosition({
                    left: rect.left,
                    top: rect.bottom + 6,
                    flipped: false,
                });
            } else {
                // If not enough room above (~40px for a tooltip), show below instead
                const flipped = rect.top < 40;
                setPosition({
                    left: rect.left + rect.width / 2,
                    top: flipped ? rect.bottom + 8 : rect.top - 8,
                    flipped,
                });
            }
        }
    }, [isHovered, placement]);

    // After the tooltip renders, clamp it to viewport edges
    const clampToViewport = useCallback((node: HTMLDivElement | null) => {
        tooltipRef.current = node;
        if (!node) return;
        requestAnimationFrame(() => {
            const rect = node.getBoundingClientRect();
            if (rect.left < VIEWPORT_PADDING) {
                node.style.left = `${VIEWPORT_PADDING}px`;
            } else if (rect.right > window.innerWidth - VIEWPORT_PADDING) {
                const overflow = rect.right - (window.innerWidth - VIEWPORT_PADDING);
                node.style.left = `${parseFloat(node.style.left) - overflow}px`;
            }
        });
    }, []);

    if (!text) return <>{children}</>;

    const getTransform = () => {
        if (placement === 'bottom-start') return 'none';
        return position.flipped ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
    };

    return (
        <>
            <div
                ref={ref}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={className}
                style={{ display: 'inline-flex' }}
            >
                {children}
            </div>

            {isHovered &&
                createPortal(
                    <div
                        ref={clampToViewport}
                        className="fixed z-[999999] w-max bg-surface-raised border border-border rounded-md shadow-float text-xs text-text-main max-w-[280px] px-3 py-2 pointer-events-none"
                        style={{
                            left: position.left,
                            top: position.top,
                            transform: getTransform(),
                        }}
                    >
                        {text}
                    </div>,
                    document.body
                )}
        </>
    );
};
