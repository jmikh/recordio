import type { ReactNode } from 'react';

interface NoticeProps {
    children: ReactNode;
    className?: string;
}

/**
 * Notice component for displaying informational messages to users.
 * Used across the app to convey important messages in a consistent style.
 */
export const Notice = ({ children, className = '' }: NoticeProps) => {
    return (
        <div
            className={`flex items-start gap-3 text-sm text-text-muted px-4 py-3 rounded-sm border border-border bg-state-inactive ${className}`}
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
