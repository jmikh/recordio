import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, className = '', ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`
               flex items-center justify-center gap-2
               border border-border
               bg-hover-subtle hover:bg-hover
               text-text-main hover:text-text-highlighted
               text-xs
               rounded-sm
               px-2 py-1.5
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

Button.displayName = 'Button';
