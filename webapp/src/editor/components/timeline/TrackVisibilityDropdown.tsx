import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdVisibility } from 'react-icons/md';
import { useUIStore, type TrackVisibility } from '../../stores/useUIStore';

const TRACKS: { key: keyof TrackVisibility; label: string }[] = [
    { key: 'zoom', label: 'Zoom' },
    { key: 'spotlight', label: 'Spotlight' },
    { key: 'captions', label: 'Captions' },
];

interface TrackVisibilityDropdownProps {
    height: number;
}

export function TrackVisibilityDropdown({ height }: TrackVisibilityDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const trackVisibility = useUIStore(s => s.trackVisibility);
    const setTrackVisibility = useUIStore(s => s.setTrackVisibility);

    // Calculate menu position when opening
    useEffect(() => {
        if (!isOpen || !triggerRef.current) return;

        const rect = triggerRef.current.getBoundingClientRect();
        setMenuStyle({
            position: 'fixed',
            bottom: window.innerHeight - rect.top + 4,
            left: rect.left + 4,
            minWidth: 160,
            zIndex: 9999,
        });
    }, [isOpen]);

    // Handle click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                triggerRef.current && !triggerRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const dropdownMenu = (
        <div
            ref={menuRef}
            className="bg-surface-overlay border border-border rounded-lg shadow-float py-1 px-1"
            style={menuStyle}
        >
            {TRACKS.map(({ key, label }) => {
                const isVisible = trackVisibility[key];

                return (
                    <button
                        key={key}
                        onClick={() => setTrackVisibility(key, !isVisible)}
                        className={`
                            w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2.5 rounded-md
                            ${isVisible
                                ? 'text-text-main hover:bg-state-hover'
                                : 'text-text-disabled hover:bg-state-hover'
                            }
                        `}
                    >
                        {/* Checkbox indicator */}
                        <div
                            className={`
                                w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors
                                ${isVisible
                                    ? 'bg-primary border-primary'
                                    : 'bg-transparent border-border-hover'
                                }
                            `}
                        >
                            {isVisible && (
                                <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-primary-fg"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                        </div>
                        <span>{label}</span>
                    </button>
                );
            })}
        </div>
    );

    return (
        <div ref={triggerRef} className="relative w-full" style={{ height }}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-center w-full h-full text-text-muted hover:text-text-main transition-colors cursor-pointer select-none"
                title="Toggle track visibility"
            >
                <MdVisibility size={18} />
            </button>

            {/* Portal-rendered dropdown menu */}
            {isOpen && createPortal(dropdownMenu, document.body)}
        </div>
    );
}
