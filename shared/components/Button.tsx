import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type ComponentType } from 'react';

type ButtonVariant = 'base' | 'primary' | 'ghost' | 'icon' | 'destructive';
type ButtonSize = 'default' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    icon?: ComponentType<{ className?: string }>;
    children?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
    base: 'interactive-base',
    primary: 'interactive-primary',
    ghost: 'interactive-ghost',
    icon: 'interactive-icon',
    destructive: 'interactive-destructive',
};

// Icon-only buttons have no visible text, so screen readers and e2e tests
// can't address them without an aria-label (see ui-guidelines: Labels &
// Testability). Warn once per icon component in dev.
const IS_DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
const warnedUnlabeledIcons = new Set<string>();
function warnIfUnlabeled(icon: ComponentType | undefined, props: ButtonHTMLAttributes<HTMLButtonElement>) {
    if (!IS_DEV || props['aria-label'] || props.title) return;
    const name = icon?.displayName || icon?.name || 'unknown-icon';
    if (warnedUnlabeledIcons.has(name)) return;
    warnedUnlabeledIcons.add(name);
    console.warn(`[Button] icon-only button (${name}) has no aria-label/title — add one so tests and screen readers can target it`);
}

/**
 * Unified Button component.
 * Maps `variant` to the corresponding `interactive-*` CSS class,
 * bakes in flex centering + gap, and supports size / fullWidth helpers.
 *
 * Pass `icon` to render a standardized icon. Button icons are auto-sized:
 *   - variant="icon" → icon-md (16px)
 *   - all other variants → icon-sm (14px)
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
    variant = 'base',
    size = 'default',
    fullWidth = false,
    icon: Icon,
    className = '',
    children,
    ...rest
}, ref) => {
    if (variant === 'icon' && !children) warnIfUnlabeled(Icon, rest);

    const base = variantClass[variant];
    const sizeClass = size === 'sm' ? 'text-xs' : '';
    const widthClass = fullWidth ? 'w-full' : '';
    const layoutClass = variant === 'icon' ? '' : 'flex items-center justify-center gap-2';
    const iconSizeClass = variant === 'icon' ? 'icon-md' : 'icon-sm';

    return (
        <button
            ref={ref}
            className={`${base} ${layoutClass} ${sizeClass} ${widthClass} ${className}`}
            {...rest}
        >
            {Icon && <Icon className={iconSizeClass} />}
            {children}
        </button>
    );
});

Button.displayName = 'Button';
