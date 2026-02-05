import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ActivatedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    isActive?: boolean;
}

/**
 * A toggle-style button that switches between inactive (outlined primary) and active (solid primary) states.
 * 
 * Inactive state: Primary border, primary text/icon, transparent background
 * Active state: Solid primary background, text-on-primary text/icon
 */
export const ActivatedButton = forwardRef<HTMLButtonElement, ActivatedButtonProps>(
    ({ children, className = '', isActive = false, ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`
                    flex items-center justify-center gap-2
                    border
                    text-sm
                    rounded-sm
                    px-3 py-2
                    font-medium
                    transition-colors
                    cursor-pointer
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${isActive
                        ? 'border-primary bg-primary text-text-on-primary'
                        : 'border-primary bg-primary/10 text-primary hover:bg-primary/15'}
                    ${className}
                `}
                {...props}
            >
                {children}
            </button>
        );
    }
);

ActivatedButton.displayName = 'ActivatedButton';
