import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdKeyboardArrowDown } from 'react-icons/md';

export interface DropdownOption<T> {
    value: T;
    label: string;
    icon?: React.ReactNode;
    suffix?: React.ReactNode;
}

interface DropdownProps<T> {
    options: DropdownOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Optional label for settings panel style. If not provided, uses compact inline mode */
    label?: string;
    /** Placeholder when no value is selected */
    placeholder?: string;
    /** Additional class for the container */
    className?: string;
    /** Additional class for the trigger button */
    buttonClassName?: string;
    /** Use full-width style (default: true) */
    fullWidth?: boolean;
}

export function Dropdown<T>({
    options,
    value,
    onChange,
    label,
    placeholder = 'Select...',
    className = '',
    buttonClassName = '',
    fullWidth = true
}: DropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Calculate menu position when opening
    useEffect(() => {
        if (!isOpen || !dropdownRef.current) return;

        const rect = dropdownRef.current.getBoundingClientRect();
        setMenuStyle({
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            minWidth: rect.width,
            zIndex: 9999,
        });
    }, [isOpen]);

    // Handle click outside to close
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                dropdownRef.current && !dropdownRef.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
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

    // Find current label
    const currentOption = options.find(o => o.value === value);
    const displayLabel = currentOption?.label || placeholder;

    const dropdownMenu = (
        <div
            ref={menuRef}
            className="bg-surface-overlay border border-border rounded-lg shadow-float max-h-[200px] overflow-y-auto py-1 px-1 scrollbar-thin"
            style={menuStyle}
        >
            {options.map((option, index) => {
                const isSelected = option.value === value;

                return (
                    <button
                        key={index}
                        onClick={() => handleSelect(option)}
                        className={`
                            w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 rounded-md
                            ${isSelected
                                ? 'bg-primary/20 text-primary-highlighted'
                                : 'text-text-main hover:bg-state-hover'
                            }
                        `}
                    >
                        {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                        <span className="flex-1">{option.label}</span>
                        {option.suffix && <span className="flex-shrink-0">{option.suffix}</span>}
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
        <div ref={dropdownRef} className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`interactive-base flex items-center justify-between ${fullWidth ? 'w-full' : ''} ${buttonClassName}`}
            >
                <div className="flex items-center gap-2">
                    {label && <span className="text-text-muted">{label}</span>}
                    <span>{displayLabel}</span>
                </div>
                <MdKeyboardArrowDown
                    size={18}
                    className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {/* Portal-rendered dropdown menu */}
            {isOpen && createPortal(dropdownMenu, document.body)}
        </div>
    );
}
