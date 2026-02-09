import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    /** Text to display in the tooltip */
    text: string;
    /** The element to wrap with a tooltip */
    children: ReactNode;
}

/**
 * Generic tooltip wrapper. Wraps any element and shows a portal-rendered
 * tooltip on hover, using the same pattern as InfoTooltip.
 */
export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setPosition({
                left: rect.left + rect.width / 2,
                top: rect.top - 8,
            });
        }
    }, [isHovered]);

    if (!text) return <>{children}</>;

    return (
        <>
            <div
                ref={ref}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{ display: 'contents' }}
            >
                {children}
            </div>

            {isHovered &&
                createPortal(
                    <div
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
