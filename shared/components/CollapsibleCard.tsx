import React, { useState, useRef, useEffect } from 'react';

export interface PreviewItem {
    /** 'text' for simple string, 'custom' for React nodes like color circles */
    type: 'text' | 'custom';
    content: string | React.ReactNode;
}

interface CollapsibleCardProps {
    /** Title displayed in the header */
    title: string;
    /** Content rendered when expanded */
    children: React.ReactNode;
    /** Initial expanded state (uncontrolled mode) */
    defaultExpanded?: boolean;
    /** Controlled expanded state */
    isExpanded?: boolean;
    /** Callback when expansion state changes */
    onExpandChange?: (expanded: boolean) => void;
    /** Preview items shown when collapsed */
    previewItems?: PreviewItem[];
    className?: string;
}

const ANIMATION_DURATION = 200; // ms

export const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
    title,
    children,
    defaultExpanded = false,
    isExpanded: controlledExpanded,
    onExpandChange,
    previewItems = [],
    className = ''
}) => {
    // Support both controlled and uncontrolled modes
    const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
    const isControlled = controlledExpanded !== undefined;
    const expanded = isControlled ? controlledExpanded : internalExpanded;

    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState<number>(0);

    // Measure content height for smooth animation
    useEffect(() => {
        if (contentRef.current) {
            setContentHeight(contentRef.current.scrollHeight);
        }
    }, [children, expanded]);

    const handleToggle = () => {
        const newValue = !expanded;
        if (!isControlled) {
            setInternalExpanded(newValue);
        }
        onExpandChange?.(newValue);
    };

    return (
        <div
            className={`
                bg-surface-inset rounded-lg
                overflow-hidden
                ${className}
            `}
            style={{ boxShadow: 'var(--shadow-card)' }}
        >
            {/* Header - Always visible */}
            <button
                onClick={handleToggle}
                className="
                    w-full flex items-center flex-wrap
                    min-h-[2.75rem]
                    px-4 py-2 pr-8
                    text-left
                    transition-colors
                    cursor-pointer
                    relative
                "
            >
                <span className="text-sm font-medium text-text-highlighted mr-4 shrink-0">
                    {title}
                </span>

                {/* Preview items - only shown when collapsed, right-aligned */}
                <div
                    className={`
                        flex items-center flex-wrap gap-1 ml-auto justify-end
                        transition-opacity duration-200
                        ${expanded ? 'opacity-0' : 'opacity-100'}
                    `}
                >
                    {previewItems.length > 0 && previewItems.map((item, index) => (
                        <span key={index} className="inline-flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                            {index > 0 && <span className="text-text-disabled">·</span>}
                            {item.type === 'text' ? (
                                <span>{item.content}</span>
                            ) : (
                                item.content
                            )}
                        </span>
                    ))}
                </div>

                {/* Chevron */}
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`
                        text-text-muted
                        transition-transform
                        hover:text-text-main
                        absolute right-4 top-1/2 -translate-y-1/2
                        ${expanded ? 'rotate-180' : 'rotate-0'}
                    `}
                    style={{ transitionDuration: `${ANIMATION_DURATION}ms` }}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Content - Animated */}
            <div
                style={{
                    maxHeight: expanded ? `${contentHeight}px` : '0px',
                    transitionDuration: `${ANIMATION_DURATION}ms`,
                    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                    transitionProperty: 'max-height'
                }}
                className="overflow-hidden"
            >
                <div ref={contentRef} className="px-4 pb-4 pt-1">
                    {children}
                </div>
            </div>
        </div>
    );
};