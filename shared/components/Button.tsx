import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type ComponentType } from 'react';

type ButtonVariant = 'base' | 'primary' | 'ghost' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    fullWidth?: boolean;
    icon?: ComponentType<{ className?: string }>;
    children?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
    base: 'interactive-base',
    primary: 'interactive-primary',
    ghost: 'interactive-ghost',
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
 * bakes in flex centering + gap, and supports the fullWidth helper.
 *
 * Every button is one size: the variant's own text-sm/h-9. There is no size
 * prop — a button that needs to be smaller is a sign it isn't a button.
 *
 * Pass `icon` to render a standardized icon. Button icons are auto-sized:
 *   - icon-only button (no children) → icon-md (16px)
 *   - button with text alongside     → icon-sm (14px)
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
    variant = 'base',
    fullWidth = false,
    icon: Icon,
    className = '',
    children,
    ...rest
}, ref) => {
    const iconOnly = Boolean(Icon) && !children;
    if (iconOnly) warnIfUnlabeled(Icon, rest);

    const base = variantClass[variant];
    const widthClass = fullWidth ? 'w-full' : '';
    const layoutClass = 'flex items-center justify-center gap-2';
    const iconSizeClass = iconOnly ? 'icon-md' : 'icon-sm';

    return (
        <button
            ref={ref}
            className={`${base} ${layoutClass} ${widthClass} ${className}`}
            {...rest}
        >
            {Icon && <Icon className={iconSizeClass} />}
            {children}
        </button>
    );
});

Button.displayName = 'Button';
