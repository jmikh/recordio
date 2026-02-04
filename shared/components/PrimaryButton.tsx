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
               bg-primary hover:enabled:bg-primary-highlighted
               text-text-on-primary
               text-sm
               rounded-sm
               px-2 py-1
               font-medium
               transition-colors
               cursor-pointer
               disabled:bg-primary-disabled disabled:text-text-disabled disabled:cursor-default
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
