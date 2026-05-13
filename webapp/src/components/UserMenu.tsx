import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuUser, LuLogOut, LuSettings } from 'react-icons/lu';
import { MdLightMode, MdDarkMode, MdOutlineBugReport } from 'react-icons/md';
import { BiCrown } from 'react-icons/bi';
import { ProBadge } from '@shared/components';
import { useUserStore } from '../editor/stores/useUserStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useThemeStore } from '../stores/useThemeStore';
import { AuthManager } from '../auth/AuthManager';
import { StripeService } from '../editor/stripe/StripeService';
import { navigate } from '../navigate';

interface UserMenuProps {
    onOpenSupportModal?: () => void;
    openDirection?: 'up' | 'down';
}

export function UserMenu({ onOpenSupportModal, openDirection = 'down' }: UserMenuProps) {
    const { email, name, picture, hasFreeTrial, trialEndsAt } = useUserStore();
    const { hasActivePlan, subscription } = useWorkspaceStore();
    const { theme, setTheme } = useThemeStore();
    const isDark = theme === 'dark';

    // Trial state comes from user_profiles table
    const isTrialing = hasFreeTrial();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [portalPos, setPortalPos] = useState({ top: 0, left: 0 });

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSignOut = async () => {
        await AuthManager.signOut();
        useUserStore.getState().clearUser();
        useWorkspaceStore.getState().clearWorkspace();
        setIsOpen(false);
        navigate('/');
    };

    const handleManageSubscription = async () => {
        const { url, error } = await StripeService.createPortalSession();

        if (error || !url) {
            console.error('[UserMenu] Failed to create portal session:', error);
            return;
        }

        // Open Stripe Customer Portal in new tab
        window.open(url, '_blank');
        setIsOpen(false);
    };

    const handleUpgrade = () => {
        setIsOpen(false);
        navigate('/workspace/settings?tab=billing');
    };

    const handleToggle = () => {
        if (!isOpen && openDirection === 'up' && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPortalPos({ top: rect.top, left: rect.left });
        }
        setIsOpen(!isOpen);
    };

    const menuContent = (
        <div className="p-4 border-b border-border bg-surface-elevated/50">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full overflow-hidden border border-border shrink-0">
                    {picture ? (
                        <img src={picture} alt={name || 'User'} className="w-full h-full object-cover" onError={() => useUserStore.getState().setUser(useUserStore.getState().userId!, email || '', name, null, null)} />
                    ) : (
                        <div className="w-full h-full bg-surface-light flex items-center justify-center text-text-muted">
                            <LuUser className="icon-md" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-highlighted truncate">{name || 'Recordio User'}</p>
                    <p className="text-xs text-text-muted truncate">{email}</p>
                </div>
            </div>

            <div className="flex flex-col gap-1 mt-1">
                <span className="text-xs text-text-muted">Status</span>
                <div className="flex flex-col gap-1 items-start">
                    <ProBadge variant={isTrialing ? 'trial' : hasActivePlan ? 'pro' : 'free'} />
                    {isTrialing && trialEndsAt && (
                        <span className="text-[11px] text-text-muted">
                            Expires {new Date(trialEndsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                    )}
                    {hasActivePlan && !isTrialing && subscription?.currentPeriodEnd && (
                        <span className="text-[11px] text-text-muted">
                            Expires {new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );

    const menuActions = (
        <div className="p-1.5 space-y-0.5">
            {hasActivePlan && !isTrialing ? (
                subscription?.stripeCustomerId && (
                    <button
                        onClick={handleManageSubscription}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-state-hover rounded-md transition-colors text-left"
                    >
                        <LuSettings className="icon-sm text-text-muted" />
                        Manage Subscription
                    </button>
                )
            ) : (
                <button
                    onClick={handleUpgrade}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-primary/10 rounded-md transition-colors text-left font-medium group"
                >
                    <BiCrown className="icon-sm group-hover:scale-110 transition-transform" />
                    Upgrade to Pro
                </button>
            )}

            <div className="h-px bg-border mx-2 my-1" />

            <button
                onClick={() => { setTheme(isDark ? 'light' : 'dark'); }}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-state-hover rounded-md transition-colors text-left"
            >
                {isDark
                    ? <MdLightMode className="icon-sm text-text-muted" />
                    : <MdDarkMode className="icon-sm text-text-muted" />
                }
                {isDark ? 'Light Mode' : 'Dark Mode'}
            </button>

            {onOpenSupportModal && (
                <button
                    onClick={() => { setIsOpen(false); onOpenSupportModal(); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-state-hover rounded-md transition-colors text-left"
                >
                    <MdOutlineBugReport className="icon-sm text-text-muted" />
                    Report a Bug
                </button>
            )}

            <div className="h-px bg-border mx-2 my-1" />

            <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-muted hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors text-left"
            >
                <LuLogOut className="icon-sm" />
                Sign Out
            </button>
        </div>
    );

    return (
        <div className="relative" ref={openDirection === 'down' ? menuRef : undefined}>
            <button
                ref={buttonRef}
                onClick={handleToggle}
                className="w-8 h-8 rounded-full overflow-hidden border border-border hover:border-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 relative"
                title={name || email || 'User Menu'}
            >
                {picture ? (
                    <img src={picture} alt={name || 'User'} className="w-full h-full object-cover" onError={() => useUserStore.getState().setUser(useUserStore.getState().userId!, email || '', name, null, null)} />
                ) : (
                    <div className="w-full h-full bg-surface-raised flex items-center justify-center text-text-muted">
                        <LuUser className="icon-sm" />
                    </div>
                )}
            </button>

            {isOpen && openDirection === 'down' && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-surface-raised border border-border rounded-lg shadow-xl z-[var(--z-index-dropdown)] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    {menuContent}
                    {menuActions}
                </div>
            )}

            {isOpen && openDirection === 'up' && createPortal(
                <div
                    ref={menuRef}
                    className="fixed w-64 bg-surface-raised border border-border rounded-lg shadow-xl z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-bottom-left"
                    style={{ bottom: window.innerHeight - portalPos.top + 8, left: portalPos.left }}
                >
                    {menuContent}
                    {menuActions}
                </div>,
                document.body
            )}
        </div>
    );
}
