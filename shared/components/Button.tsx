import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type ButtonVariant = 'base' | 'primary' | 'ghost' | 'icon' | 'destructive';
type ButtonSize = 'default' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    children?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
    base: 'interactive-base',
    primary: 'interactive-primary',
    ghost: 'interactive-ghost',
    icon: 'interactive-icon',
    destructive: 'interactive-destructive',
};

/**
 * Unified Button component.
 * Maps `variant` to the corresponding `interactive-*` CSS class,
 * bakes in flex centering + gap, and supports size / fullWidth helpers.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
    variant = 'base',
    size = 'default',
    fullWidth = false,
    className = '',
    children,
    ...rest
}, ref) => {
    const base = variantClass[variant];
    const sizeClass = size === 'sm' ? 'text-xs' : '';
    const widthClass = fullWidth ? 'w-full' : '';
    const layoutClass = variant === 'icon' ? '' : 'flex items-center justify-center gap-2';

    return (
        <button
            ref={ref}
            className={`${base} ${layoutClass} ${sizeClass} ${widthClass} ${className}`}
            {...rest}
        >
            {children}
        </button>
    );
});

Button.displayName = 'Button';
