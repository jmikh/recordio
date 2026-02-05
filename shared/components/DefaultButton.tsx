import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
}

export const DefaultButton = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, className = '', ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`
               flex items-center justify-center gap-2
               h-9
               border border-border
               bg-state-inactive hover:bg-state-hover
               text-text-main hover:text-text-highlighted
               text-sm
               rounded-[var(--radius-interactive)]
               px-3
               transition-colors
               cursor-pointer
               disabled:opacity-50
               ${className}
            `}
                {...props}
            >
                {children}
            </button>
        );
    }
);

DefaultButton.displayName = 'DefaultButton';
