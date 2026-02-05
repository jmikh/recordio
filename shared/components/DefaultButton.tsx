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
                className={`interactive-base flex items-center justify-center gap-2 ${className}`}
                {...props}
            >
                {children}
            </button>
        );
    }
);

DefaultButton.displayName = 'DefaultButton';
