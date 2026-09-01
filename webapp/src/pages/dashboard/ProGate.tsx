import { useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TrialExtendLink } from '../../billing/TrialExtendLink';

interface ProGateProps {
    /** The locked feature name shown in the tooltip, e.g. "shareable links" */
    feature: string;
    children: ReactNode;
    className?: string;
}

/**
 * Wraps a UI element that requires a paid plan.
 * Renders the child disabled/dimmed and shows a portal tooltip with an upgrade link on hover.
 */
export function ProGate({ feature, children, className }: ProGateProps) {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const handleMouseEnter = () => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2, y: rect.top });
    };

    return (
        <div
            ref={wrapperRef}
            className={`inline-flex${className ? ` ${className}` : ''}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setPos(null)}
        >
            <div className="pointer-events-none opacity-50 select-none w-full">
                {children}
            </div>

            {pos && createPortal(
                <div
                    className="fixed z-999999 w-max max-w-55 bg-surface-raised border border-border rounded-md shadow-float px-3 py-2 text-xs text-text-main -translate-x-1/2 -translate-y-full"
                    style={{ left: pos.x, top: pos.y - 8 }}
                >
                    <p className="mb-1.5">Upgrade to use {feature}</p>
                    {/* New tab (Step 4): keep the caller's context alive */}
                    <button
                        className="text-primary font-medium hover:underline"
                        onClick={() => window.open('/workspace/settings/billing', '_blank')}
                    >
                        Upgrade →
                    </button>
                    <TrialExtendLink label="or extend free trial" className="mt-1" />
                </div>,
                document.body
            )}
        </div>
    );
}
