import { useState, useRef, useEffect } from 'react';
import { FaUser, FaSignOutAlt, FaCrown, FaCog } from 'react-icons/fa';
import { useUserStore } from '../../stores/useUserStore';
import { AuthManager } from '../../auth/AuthManager';
import { StripeService } from '../../stripe/StripeService';
import { Button } from './Button';

export function UserMenu() {
    const { email, isPro, subscription } = useUserStore();
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

    return (
        <div className="relative" ref={menuRef}>
            <Button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-2 py-1.5"
            >
                <FaUser size={12} />
                <span className="text-xs max-w-[120px] truncate">{email}</span>
                {isPro && (
                    <FaCrown size={10} className="text-yellow-500" title="Pro Subscriber" />
                )}
            </Button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-surface-raised border border-border rounded-sm shadow-lg z-50">
                    <div className="p-3 border-b border-border">
                        <p className="text-xs text-text-muted mb-1">Signed in as</p>
                        <p className="text-sm text-text-highlighted font-medium truncate">{email}</p>
                        {isPro ? (
                            <div className="flex items-center gap-1 mt-2 text-yellow-500">
                                <FaCrown size={10} />
                                <span className="text-xs font-medium">Pro Subscriber</span>
                            </div>
                        ) : (
                            <p className="text-xs text-text-muted mt-2">Free Plan</p>
                        )}
                    </div>

                    <div className="p-2">
                        {isPro && subscription.stripeCustomerId && (
                            <button
                                onClick={handleManageSubscription}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-main hover:text-text-highlighted hover:bg-hover rounded-sm transition-colors mb-1"
                            >
                                <FaCog size={12} />
                                Manage Subscription
                            </button>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-main hover:text-text-highlighted hover:bg-hover rounded-sm transition-colors"
                        >
                            <FaSignOutAlt size={12} />
                            Sign Out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
