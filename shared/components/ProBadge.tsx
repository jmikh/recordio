interface ProBadgeProps {
    variant?: 'pro' | 'free';
    className?: string;
}

export function ProBadge({ variant = 'pro', className = '' }: ProBadgeProps) {
    const bg = variant === 'pro' ? 'bg-primary' : 'bg-text-disabled';
    return (
        <span className={`${bg} text-text-on-primary text-[10px] font-bold px-2 py-0.5 rounded leading-none uppercase ${className}`}>
            {variant === 'pro' ? 'Pro' : 'Free'}
        </span>
    );
}
