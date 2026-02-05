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
               flex items-center justify-center gap-2
               h-9
               border border-border
               bg-primary hover:enabled:bg-primary-highlighted
               text-text-on-primary
               text-sm
               rounded-[var(--radius-interactive)]
               px-3
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
