import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption<T> {
    value: T;
    label: string;
    icon?: React.ReactNode;
}

interface DropdownProps<T> {
    options: DropdownOption<T>[];
    value: T;
    onChange: (value: T) => void;
    trigger: React.ReactNode;
    direction?: 'down' | 'up';
    usePortal?: boolean;
    anchorEl?: HTMLElement | null;
    className?: string;
}

export function Dropdown<T>({
    options,
    value,
    onChange,
    trigger,
    direction = 'down',
    usePortal = false,
    anchorEl,
    className = ''
}: DropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    // Handle click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node) &&
                triggerRef.current &&
                !triggerRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleSelect = (option: DropdownOption<T>) => {
        onChange(option.value);
        setIsOpen(false);
    };

    // Calculate position for portal-based dropdown
    const getPortalStyle = (): React.CSSProperties => {
        if (!anchorEl) return {};

        const rect = anchorEl.getBoundingClientRect();

        if (direction === 'up') {
            return {
                bottom: `${window.innerHeight - rect.top + 8}px`,
                left: `${rect.left}px`,
            };
        } else {
            return {
                top: `${rect.bottom + 8}px`,
                left: `${rect.left}px`,
            };
        }
    };

    const dropdownContent = (
        <div
            ref={dropdownRef}
            className={`bg-surface-overlay border border-border rounded shadow-xl p-1 flex flex-col min-w-[120px] ${usePortal ? 'fixed z-[9999]' : ''
                } ${className}`}
            style={usePortal ? getPortalStyle() : {}}
        >
            {options.map((option, index) => {
                const isSelected = option.value === value;

                return (
                    <button
                        key={index}
                        onClick={() => handleSelect(option)}
                        className={`w-full text-left px-4 py-2 text-xs transition-colors flex items-center gap-2 rounded-sm ${isSelected
                            ? 'bg-primary/20 text-primary'
                            : 'text-text-main hover:bg-hover hover:text-text-highlighted'
                            }`}
                    >
                        {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                        <span className="flex-1">{option.label}</span>
                        {isSelected && (
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="flex-shrink-0"
                            >
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="relative">
            <div ref={triggerRef} onClick={() => setIsOpen(!isOpen)}>
                {trigger}
            </div>

            {isOpen && (
                <>
                    {!usePortal && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                            <div
                                className={`absolute ${direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
                                    } right-0 z-50`}
                            >
                                {dropdownContent}
                            </div>
                        </>
                    )}
                    {usePortal && createPortal(dropdownContent, document.body)}
                </>
            )}
        </div>
    );
}
