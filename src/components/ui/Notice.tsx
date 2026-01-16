import type { ReactNode } from 'react';

interface NoticeProps {
    children: ReactNode;
    variant?: 'info' | 'warning' | 'error';
    className?: string;
}

/**
 * Notice component for displaying informational, warning, or error messages to users.
 * Used across the app to convey important messages in a consistent style.
 */
export const Notice = ({ children, variant = 'info', className = '' }: NoticeProps) => {
    const variantStyles = {
        info: 'text-text-main bg-hover-subtle border-border',
        warning: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
        error: 'text-red-400 bg-red-500/10 border-red-500/20',
    };

    return (
        <div
            className={`font-normal flex items-start gap-3 text-sm px-4 py-3 rounded-lg border ${variantStyles[variant]} ${className}`}
        >
            {/* Exclamation Icon */}
            <div className="flex-shrink-0 mt-0.5">
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
            </div>
            {/* Content */}
            <div className="flex-1">
                {children}
            </div>
        </div>
    );
};
