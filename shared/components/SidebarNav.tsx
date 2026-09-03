import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';

// Reports the active item's element to the surrounding SidebarNav so it can
// position the accent bar. Cleanup (report null) runs before the newly active
// item's effect, so handoff between items works without flicker.
const SidebarNavContext = createContext<(el: HTMLElement | null) => void>(() => {});

interface SidebarNavProps {
    id?: string;
    className?: string;
    children: ReactNode;
}

/**
 * Shared sidebar navigation container — full-bleed to the left edge with a
 * right margin, plus a sliding 3px accent bar tracking the active item.
 * Used by the dashboard sidebar and the editor settings nav.
 */
export function SidebarNav({ id, className = '', children }: SidebarNavProps) {
    const [bar, setBar] = useState<{ top: number; height: number } | null>(null);
    const reportActive = useCallback((el: HTMLElement | null) => {
        setBar(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
    }, []);

    return (
        <nav id={id} className={`relative flex flex-col gap-0.5 pl-0 pr-3 ${className}`}>
            {bar && (
                <div
                    className="absolute left-0 w-0.75 bg-primary rounded-r-sm transition-all duration-200 ease-out"
                    style={{ top: bar.top, height: bar.height }}
                />
            )}
            <SidebarNavContext.Provider value={reportActive}>
                {children}
            </SidebarNavContext.Provider>
        </nav>
    );
}

interface SidebarNavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    /** Pass the component type (like Button's `icon` prop) — auto-sized to icon-lg. */
    icon?: ComponentType<{ className?: string }>;
    active?: boolean;
    /** Right-aligned slot: count badge, chevron, etc. */
    trailing?: ReactNode;
}

/**
 * One nav row: icon + label + optional trailing slot.
 * Hover shows the selected treatment (primary tint + highlighted text); the
 * selected state additionally gets the accent bar and icon scale.
 */
export function SidebarNavItem({
    label,
    icon: Icon,
    active = false,
    trailing,
    disabled,
    className = '',
    ...rest
}: SidebarNavItemProps) {
    const reportActive = useContext(SidebarNavContext);
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!active) return;
        reportActive(ref.current);
        return () => reportActive(null);
    }, [active, reportActive]);

    // No native `disabled`: it would suppress hover events, which consumers
    // need for disabled-item tooltips. Consumers guard their own onClick.
    return (
        <button
            ref={ref}
            type="button"
            aria-disabled={disabled || undefined}
            aria-current={active ? 'true' : undefined}
            className={`group flex items-center gap-3 w-full py-2.5 px-4 rounded-r-lg border-none text-left transition-colors duration-200 ${
                disabled
                    ? 'opacity-50 cursor-default bg-transparent'
                    : active
                        ? 'bg-primary/15 cursor-pointer'
                        : 'bg-transparent cursor-pointer hover:bg-primary/15'
            } ${className}`}
            {...rest}
        >
            {Icon && (
                <span
                    className={`flex shrink-0 transition-all ${
                        disabled
                            ? 'text-text-disabled'
                            : active
                                ? 'text-primary scale-110'
                                : 'text-text-main group-hover:text-primary'
                    }`}
                >
                    <Icon className="icon-lg" />
                </span>
            )}
            <span
                className={`flex-1 min-w-0 truncate text-sm transition-colors ${
                    disabled
                        ? 'text-text-disabled'
                        : active
                            ? 'text-text-highlighted'
                            : 'text-text-main group-hover:text-text-highlighted'
                }`}
            >
                {label}
            </span>
            {trailing && <span className="ml-auto shrink-0 flex items-center">{trailing}</span>}
        </button>
    );
}
