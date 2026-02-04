import React, { useState, useRef, useEffect, type ReactNode } from 'react';
import { MdInfoOutline } from 'react-icons/md';
import { createPortal } from 'react-dom';

interface InfoTooltipProps {
    /** Description text explaining the feature */
    description: string;
    /** Optional path to the demo video */
    videoSrc?: string;
    /** Optional additional content to render below the description */
    children?: ReactNode;
}

/**
 * InfoTooltip provides a consistent info icon with tooltip experience.
 * Features:
 * - Info icon trigger
 * - Portal-rendered tooltip (escapes stacking contexts)
 * - Optional 480px video
 * - Description text
 * - Optional children for additional content
 */
export const InfoTooltip: React.FC<InfoTooltipProps> = ({ description, videoSrc, children }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const iconRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHovered && iconRef.current) {
            const rect = iconRef.current.getBoundingClientRect();
            setPosition({
                left: rect.left + rect.width / 2,
                top: rect.bottom + 8,
            });
        }
    }, [isHovered]);

    return (
        <>
            <div
                ref={iconRef}
                className="relative flex items-center justify-center cursor-pointer"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <MdInfoOutline
                    size={14}
                    className="text-text-muted hover:text-text-highlighted transition-colors"
                />
            </div>

            {/* Tooltip - rendered via portal to escape stacking contexts */}
            {isHovered &&
                createPortal(
                    <div
                        className={`fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float overflow-hidden text-xs text-text-main ${videoSrc
                                ? 'w-[480px] px-5 py-3 flex flex-col items-center'
                                : 'max-w-[280px]'
                            }`}
                        style={{
                            left: position.left,
                            top: position.top,
                            transform: 'translateX(-50%)'
                        }}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    >
                        {/* Demo Video - fixed width, never shrinks */}
                        {videoSrc && (
                            <video
                                src={videoSrc}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="w-full rounded"
                            />
                        )}

                        {/* Description text */}
                        <div className={videoSrc ? 'mt-2 text-center' : 'px-3 py-2'}>
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
