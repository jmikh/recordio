import type { ReactNode } from 'react';

export type StatusBadgeVariant = 'default' | 'primary' | 'secondary';

interface StatusBadgeProps {
    children: ReactNode;
    /** Neutral by default; `primary` for an active/affirmative state, `secondary` for one that wants attention. */
    variant?: StatusBadgeVariant;
    /** Render the label in caps. CSS-only, so the accessible name stays as written. */
    uppercase?: boolean;
    className?: string;
}

const variantStyles: Record<StatusBadgeVariant, string> = {
    default: 'bg-state-inactive text-text-muted',
    primary: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary/20 text-text-highlighted',
} as const;

/**
 * Small pill reporting the current state of the thing next to it — a plan
 * tier, a save state, a live activity. It is `role="status"` because the
 * label is expected to change as that state does; for a static tag or a
 * counter, use `text-badge` directly instead.
 */
export function StatusBadge({ children, variant = 'default', uppercase = false, className = '' }: StatusBadgeProps) {
    return (
        <span
            className={`text-badge rounded-[var(--radius-sm)] px-2 py-1 ${variantStyles[variant]} ${uppercase ? 'uppercase tracking-wide' : ''} ${className}`}
            role="status"
        >
            {children}
        </span>
    );
}
