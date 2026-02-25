import { useState, useRef, useEffect } from 'react';
import { FaUser, FaSignOutAlt, FaCog } from 'react-icons/fa';
import { BiCrown } from 'react-icons/bi';
import { useUserStore } from '../editor/stores/useUserStore';
import { AuthManager } from '../auth/AuthManager';
import { StripeService } from '../editor/stripe/StripeService';

interface UserMenuProps {
    onOpenUpgradeModal: () => void;
}

export function UserMenu({ onOpenUpgradeModal }: UserMenuProps) {
    const { email, name, picture, isPro, subscription, freeTrialUntil } = useUserStore();

    // Detect trial state: Stripe trialing OR active free trial
    const hasActiveFreeTriaI = freeTrialUntil ? new Date(freeTrialUntil).getTime() > Date.now() : false;
    const isTrialing = subscription.status === 'trialing' || hasActiveFreeTriaI;
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
        setIsOpen(false);
    };

    const handleManageSubscription = async () => {
        if (!subscription.stripeCustomerId) {
            console.error('[UserMenu] No Stripe customer ID found');
            return;
        }

        const { url, error } = await StripeService.createPortalSession(subscription.stripeCustomerId);

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
        onOpenUpgradeModal();
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-8 h-8 rounded-full overflow-hidden border border-border hover:border-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 relative"
                title={name || email || 'User Menu'}
            >
                {picture ? (
                    <img src={picture} alt={name || 'User'} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-surface-raised flex items-center justify-center text-text-muted">
                        <FaUser size={14} />
                    </div>
                )}
                {isPro && (
                    <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-[1px]">
                        <BiCrown size={10} className="text-yellow-500" />
                    </div>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-surface-raised border border-border rounded-lg shadow-xl z-[var(--z-index-dropdown)] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="p-4 border-b border-border bg-surface-elevated/50">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-border shrink-0">
                                {picture ? (
                                    <img src={picture} alt={name || 'User'} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-surface-light flex items-center justify-center text-text-muted">
                                        <FaUser size={16} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-text-highlighted truncate">{name || 'Recordio User'}</p>
                                <p className="text-xs text-text-muted truncate">{email}</p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between bg-background/50 rounded p-2 border border-border/50">
                            <span className="text-xs text-text-muted">Status</span>
                            <div className="flex flex-col items-end gap-0.5">
                                {isTrialing ? (
                                    <div className="flex items-center gap-1.5 text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                                        <BiCrown size={10} />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Pro Trial</span>
                                    </div>
                                ) : isPro ? (
                                    <div className="flex items-center gap-1.5 text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                                        <BiCrown size={10} />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Pro</span>
                                    </div>
                                ) : (
                                    <span className="text-[10px] font-medium text-text-muted bg-surface-light px-2 py-0.5 rounded-full">Free Plan</span>
                                )}
                                {isTrialing && freeTrialUntil && (
                                    <span className="text-[10px] text-text-muted">
                                        expires {new Date(freeTrialUntil).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </span>
                                )}
                                {isPro && !isTrialing && subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                                    <span className="text-[10px] text-text-muted">
                                        expires {new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="p-1.5 space-y-0.5">
                        {isPro && !isTrialing ? (
                            subscription.stripeCustomerId && (
                                <button
                                    onClick={handleManageSubscription}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-state-hover rounded-md transition-colors text-left"
                                >
                                    <FaCog size={14} className="text-text-muted" />
                                    Manage Subscription
                                </button>
                            )
                        ) : (
                            <button
                                onClick={handleUpgrade}
                                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-primary/10 rounded-md transition-colors text-left font-medium group"
                            >
                                <BiCrown size={14} className="group-hover:scale-110 transition-transform" />
                                Upgrade to Pro
                            </button>
                        )}

                        <div className="h-px bg-border mx-2 my-1" />

                        <button
                            onClick={handleSignOut}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-muted hover:text-red-400 hover:bg-red-900/10 rounded-md transition-colors text-left"
                        >
                            <FaSignOutAlt size={14} />
                            Sign Out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
