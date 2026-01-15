import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface SecondaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
}

export const SecondaryButton = forwardRef<HTMLButtonElement, SecondaryButtonProps>(
    ({ children, className = '', ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`
                border border-border
                bg-secondary hover:bg-secondary-highlighted
                text-secondary-fg
                rounded-sm
                px-2 py-1
                font-medium
                transition-colors
                cursor-pointer
                disabled:bg-secondary-muted disabled:text-text-muted
                ${className}
            `}
                {...props}
            >
                {children}
            </button>
        );
    }
);

SecondaryButton.displayName = 'SecondaryButton';
