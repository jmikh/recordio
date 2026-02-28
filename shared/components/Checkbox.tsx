import React from 'react';

interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** Optional label displayed to the right of the checkbox */
    label?: string;
    className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
    checked,
    onChange,
    label,
    className = '',
}) => {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`flex items-center gap-1.5 cursor-pointer select-none ${className}`}
        >
            {/* Box */}
            <div
                className={`
                    w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors
                    ${checked
                        ? 'bg-primary border-primary'
                        : 'bg-transparent border-text-disabled hover:border-text-muted'
                    }
                `}
            >
                {checked && (
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
            {label && (
                <span className="text-xs text-text-muted">{label}</span>
            )}
        </button>
    );
};
