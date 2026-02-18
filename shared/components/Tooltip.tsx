import React, { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    /** Text to display in the tooltip */
    text: string;
    /** The element to wrap with a tooltip */
    children: ReactNode;
}

const VIEWPORT_PADDING = 8;

/**
 * Generic tooltip wrapper. Wraps any element and shows a portal-rendered
 * tooltip on hover, using the same pattern as InfoTooltip.
 * Clamps to viewport edges so content never goes off-screen.
 */
export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const ref = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setPosition({
                left: rect.left + rect.width / 2,
                top: rect.top - 8,
            });
        }
    }, [isHovered]);

    // After the tooltip renders, clamp it to viewport edges
    const clampToViewport = useCallback((node: HTMLDivElement | null) => {
        tooltipRef.current = node;
        if (!node) return;
        requestAnimationFrame(() => {
            const rect = node.getBoundingClientRect();
            if (rect.left < VIEWPORT_PADDING) {
                node.style.left = `${VIEWPORT_PADDING + rect.width / 2}px`;
            } else if (rect.right > window.innerWidth - VIEWPORT_PADDING) {
                node.style.left = `${window.innerWidth - VIEWPORT_PADDING - rect.width / 2}px`;
            }
        });
    }, []);

    if (!text) return <>{children}</>;

    return (
        <>
            <div
                ref={ref}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{ display: 'inline-flex' }}
            >
                {children}
            </div>

            {isHovered &&
                createPortal(
                    <div
                        ref={clampToViewport}
                        className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float text-xs text-text-main max-w-[280px] px-3 py-2 pointer-events-none"
                        style={{
                            left: position.left,
                            top: position.top,
                            transform: 'translate(-50%, -100%)',
                        }}
                    >
                        {text}
                    </div>,
                    document.body
                )}
        </>
    );
};
