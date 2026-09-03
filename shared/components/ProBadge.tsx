interface ProBadgeProps {
    variant?: 'pro' | 'free' | 'trial';
    className?: string;
}

const variantStyles = {
    pro: 'bg-primary',
    free: 'bg-text-disabled',
    trial: 'bg-secondary',
} as const;

const variantLabels = {
    pro: 'Pro',
    free: 'Free',
    trial: 'Trial',
} as const;

export function ProBadge({ variant = 'pro', className = '' }: ProBadgeProps) {
    return (
        <span className={`${variantStyles[variant]} text-text-on-primary text-badge px-2 py-0.5 rounded uppercase ${className}`}>
            {variantLabels[variant]}
        </span>
    );
}
