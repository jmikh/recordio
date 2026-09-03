import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdKeyboardArrowDown } from 'react-icons/md';

export interface DropdownOption<T> {
    value: T;
    label: string;
    icon?: React.ReactNode;
    suffix?: React.ReactNode;
    disabled?: boolean;
    /** Destructive action (e.g. delete/remove) — rendered in red */
    destructive?: boolean;
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
    /** Optional content rendered to the right of the trigger button (after the arrow) */
    suffix?: React.ReactNode;
    /** If true, hides option suffixes in the trigger button (still shown in the menu) */
    hideSuffixInTrigger?: boolean;
    /** Accessible name for the trigger when there's no visible `label` (compact mode) */
    ariaLabel?: string;
}

export function Dropdown<T>({
    options,
    value,
    onChange,
    label,
    placeholder = 'Select...',
    className = '',
    buttonClassName = '',
    fullWidth = true,
    suffix,
    hideSuffixInTrigger = false,
    ariaLabel,
}: DropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Calculate menu position when opening — flip upward if not enough space below
    useEffect(() => {
        if (!isOpen || !dropdownRef.current) return;

        const rect = dropdownRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const estimatedMenuHeight = 150; // conservative estimate

        if (spaceBelow < estimatedMenuHeight) {
            setMenuStyle({
                position: 'fixed',
                bottom: window.innerHeight - rect.top + 4,
                left: rect.left,
                minWidth: rect.width,
                zIndex: 9999,
            });
        } else {
            setMenuStyle({
                position: 'fixed',
                top: rect.bottom + 4,
                left: rect.left,
                minWidth: rect.width,
                zIndex: 9999,
            });
        }
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
        if (option.disabled) return;
        onChange(option.value);
        setIsOpen(false);
    };

    // Find current label
    const currentOption = options.find(o => o.value === value);
    const displayLabel = currentOption?.label || placeholder;

    const dropdownMenu = (
        <div
            ref={menuRef}
            className="bg-surface-raised border border-border rounded-lg shadow-float max-h-[280px] overflow-y-auto py-1 px-1 scrollbar-thin"
            style={menuStyle}
        >
            {options.map((option, index) => {
                const isSelected = option.value === value;
                const isDisabled = option.disabled;

                return (
                    <button
                        key={index}
                        onClick={() => handleSelect(option)}
                        className={`
                            w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 rounded-md
                            ${isDisabled
                                ? 'text-text-disabled cursor-default'
                                : option.destructive
                                    ? 'text-destructive hover:bg-destructive/10'
                                    : isSelected
                                        ? 'bg-primary/20 text-primary-highlighted'
                                        : 'text-text-main hover:bg-state-hover'
                            }
                        `}
                    >
                        {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                        <span className="flex-1 truncate">{option.label}</span>
                        {option.suffix && <span className="flex-shrink-0">{option.suffix}</span>}
                    </button>
                );
            })}
        </div>
    );

    return (
        <div ref={dropdownRef} className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className={`interactive-base flex items-center justify-between ${fullWidth ? 'w-full' : ''} ${buttonClassName}`}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {label && <span className="text-text-muted flex-shrink-0">{label}</span>}
                    <span className="truncate">{displayLabel}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    {!hideSuffixInTrigger && currentOption?.suffix && <span className="flex-shrink-0">{currentOption.suffix}</span>}
                    <MdKeyboardArrowDown
                        className={`icon-lg transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                    {suffix}
                </div>
            </button>

            {/* Portal-rendered dropdown menu */}
            {isOpen && createPortal(dropdownMenu, document.body)}
        </div>
    );
}
