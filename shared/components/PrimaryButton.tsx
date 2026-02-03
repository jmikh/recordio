import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
}

export const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
    ({ children, className = '', ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`
               border border-border
               bg-primary hover:bg-primary-highlighted
               text-text-on-primary
               rounded-sm
               px-2 py-1
               font-medium
               transition-colors
               cursor-pointer
               disabled:opacity-50 disabled:cursor-not-allowed
               ${className}
            `}
                {...props}
            >
                {children}
            </button>
        );
    }
);

PrimaryButton.displayName = 'PrimaryButton';
