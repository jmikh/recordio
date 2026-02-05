import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ActivatedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    isActive?: boolean;
}

/**
 * A toggle-style button that looks like DefaultButton when inactive.
 * When active, shows an animated dot traveling around the border.
 */
export const ActivatedButton = forwardRef<HTMLButtonElement, ActivatedButtonProps>(
    ({ children, className = '', isActive = false, ...props }, ref) => {
        return (
            <button
                ref={ref}
                className={`
                    relative
                    flex items-center justify-center gap-2
                    h-9
                    border border-border
                    text-sm
                    rounded-[var(--radius-interactive)]
                    px-3
                    transition-colors
                    cursor-pointer
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${isActive
                        ? 'bg-state-hover text-text-highlighted'
                        : 'bg-state-inactive hover:bg-state-hover text-text-main hover:text-text-highlighted'}
                    ${className}
                `}
                {...props}
            >
                {/* Traveling dot animation when active */}
                {isActive && (
                    <span
                        className="absolute inset-0 overflow-hidden pointer-events-none"
                        style={{
                            borderRadius: 'var(--radius-interactive)',
                            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                            maskComposite: 'exclude',
                            WebkitMaskComposite: 'xor',
                            padding: '1px',
                        }}
                    >
                        <span
                            className="absolute w-full h-full"
                            style={{
                                background: 'conic-gradient(from 0deg, transparent 0deg, transparent 340deg, var(--primary) 360deg)',
                                animation: 'spin 2s linear infinite',
                            }}
                        />
                    </span>
                )}
                {children}
            </button>
        );
    }
);

ActivatedButton.displayName = 'ActivatedButton';
