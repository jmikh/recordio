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
               border border-border
               bg-hover-subtle hover:bg-hover
               text-text-muted hover:text-text-main
               rounded-sm
               px-2 py-1
               font-sm
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
