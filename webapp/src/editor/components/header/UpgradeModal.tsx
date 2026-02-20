import { useState, useEffect } from 'react';
import { FaCrown, FaCheck, FaGift } from 'react-icons/fa';
import { XButton, Modal } from '@shared/components';
import { StripeService } from '../../stripe/StripeService';
import { useUserStore } from '../../stores/useUserStore';
import { supabase } from '../../../auth/AuthManager';

interface UpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSignInRequest: () => void;
    selectedQuality?: string | null;
}

type BillingInterval = 'monthly' | 'yearly';

export function UpgradeModal({ isOpen, onClose, onSignInRequest, selectedQuality }: UpgradeModalProps) {
    const [loading, setLoading] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<BillingInterval>('yearly');
    const { userId, email, isAuthenticated } = useUserStore();

    // Poll for subscription status after checkout opens
    useEffect(() => {
        if (!isOpen || !checkingStatus || !userId || success) return;

        const pollInterval = setInterval(async () => {
            if (!supabase) return;

            // Check if user has active subscription
            // Use maybeSingle() instead of single() to avoid 406 errors when subscription doesn't exist yet
            const { data, error } = await supabase
                .from('subscriptions')
                .select('status, plan_id, current_period_end, cancel_at_period_end, stripe_customer_id')
                .eq('user_id', userId)
                .maybeSingle();

            // Ignore "not found" - it's expected while waiting for webhook to create subscription
            // Only log actual errors (network issues, permission errors, etc.)
            if (error) {
                console.error('[UpgradeModal] Error checking subscription status:', error);
                return;
            }

            if (data?.status === 'active') {
                setSuccess(true);
                setCheckingStatus(false);

                // Reload user store to pick up Pro status
                const { setSubscription } = useUserStore.getState();
                setSubscription({
                    status: 'active',
                    planId: data.plan_id || '',
                    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : new Date(),
                    cancelAtPeriodEnd: data.cancel_at_period_end || false,
                    stripeCustomerId: data.stripe_customer_id || null
                });

                // Auto-close after showing success message
                setTimeout(() => {
                    onClose();
                }, 2000);
            }
        }, 1000); // Check every second

        return () => clearInterval(pollInterval);
    }, [isOpen, checkingStatus, userId, success, onClose]);

    // Reset states when modal closes
    useEffect(() => {
        if (!isOpen) {
            setLoading(false);
            setCheckingStatus(false);
            setSuccess(false);
            setError(null);
        }
    }, [isOpen]);

    const handleUpgrade = async () => {
        if (!userId || !email) {
            onClose();
            onSignInRequest();
            return;
        }

        setLoading(true);
        setError(null);

        const { error: checkoutError } = await StripeService.createCheckoutSession(userId, email, billingInterval);

        if (checkoutError) {
            setError(checkoutError.message || 'Failed to start checkout. Please try again.');
            setLoading(false);
        } else {
            // Checkout opened successfully, start polling
            setLoading(false);
            setCheckingStatus(true);
        }
    };

    const monthlyPrice = 12;
    const yearlyPrice = 59;
    const yearlyMonthlyEquivalent = (yearlyPrice / 12).toFixed(2);
    const savingsPercent = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[380px]">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <FaCrown className="text-yellow-500" size={24} />
                    <h2 className="text-xl font-semibold text-text-highlighted">
                        Upgrade to Pro
                    </h2>
                </div>
                <XButton onClick={onClose} title="Close" />
            </div>

            {/* Success Message */}
            {success && (
                <div className="mb-6 bg-green-900/20 border border-green-500/50 rounded-sm p-4 text-center">
                    <FaCheck className="text-green-500 mx-auto mb-2" size={32} />
                    <p className="text-lg font-semibold text-green-400 mb-1">
                        🎉 Welcome to Pro!
                    </p>
                    <p className="text-sm text-text-muted">
                        Your subscription is now active. Enjoy unlimited exports!
                    </p>
                </div>
            )}

            {/* Checking Status Message */}
            {checkingStatus && !success && (
                <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-3 text-center">
                    <p className="text-sm text-text-highlighted">
                        ⏳ Waiting for payment completion...
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                        Complete payment in the checkout tab, then return here
                    </p>
                </div>
            )}

            {selectedQuality && !success && !checkingStatus && (
                <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-3">
                    <p className="text-sm text-text-highlighted">
                        <strong>{selectedQuality}</strong> exports are only available for Pro subscribers.
                    </p>
                </div>
            )}

            {/* Free Credit Banner (non-authenticated users only) */}
            {!isAuthenticated && (
                <div className="mb-4 bg-primary/10 border border-primary/30 rounded-sm p-3 flex items-start gap-3">
                    <FaGift className="text-primary mt-0.5 shrink-0" size={16} />
                    <div>
                        <p className="text-sm text-text-highlighted">
                            <strong>Get a free HD/4K export!</strong>
                        </p>
                        <p className="text-xs text-text-muted mt-0.5">
                            <button
                                onClick={() => { onClose(); onSignInRequest(); }}
                                className="text-primary hover:text-primary-highlighted underline"
                            >
                                Sign in
                            </button>
                            {' '}to claim your free export credit — no subscription needed.
                        </p>
                    </div>
                </div>
            )}

            {/* Billing Toggle */}
            <div className="flex items-center justify-center gap-1 mb-5 bg-surface-inset rounded-lg p-1">
                <button
                    onClick={() => setBillingInterval('monthly')}
                    className={`flex-1 py-1.5 px-4 text-sm font-medium rounded-md transition-all ${billingInterval === 'monthly'
                        ? 'bg-surface-raised text-text-highlighted shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Monthly
                </button>
                <button
                    onClick={() => setBillingInterval('yearly')}
                    className={`flex-1 py-1.5 px-4 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-2 ${billingInterval === 'yearly'
                        ? 'bg-surface-raised text-text-highlighted shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Yearly
                    <span className="text-[11px] font-semibold text-success">Save {savingsPercent}%</span>
                </button>
            </div>

            {/* Pricing Card */}
            <div className="bg-surface rounded-lg p-6 mb-6 border border-border">
                <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-bold text-text-highlighted">
                        ${billingInterval === 'monthly' ? monthlyPrice : yearlyPrice}
                    </span>
                    <span className="text-text-muted">
                        /{billingInterval === 'monthly' ? 'month' : 'year'}
                    </span>
                </div>

                {billingInterval === 'yearly' && (
                    <p className="text-xs text-text-muted mb-4">
                        That's just ${yearlyMonthlyEquivalent}/month
                    </p>
                )}
                {billingInterval === 'monthly' && (
                    <p className="text-xs text-text-muted mb-4">
                        ${yearlyPrice}/yr if billed annually
                    </p>
                )}

                <ul className="space-y-3">
                    <li className="flex items-center gap-3 text-sm">
                        <FaCheck className="text-green-500 shrink-0" size={14} />
                        <span className="text-text-highlighted">Unlimited 1080p+ & 60fps exports</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                        <FaCheck className="text-green-500 shrink-0" size={14} />
                        <span className="text-text-highlighted">No watermarks</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm">
                        <FaCheck className="text-green-500 shrink-0" size={14} />
                        <span className="text-text-highlighted">Priority support</span>
                    </li>
                </ul>
            </div>

            {/* Error Message */}
            {error && (
                <div className="mb-4 bg-red-900/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-sm text-xs">
                    {error}
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
                <button onClick={onClose} className="interactive-base flex items-center justify-center gap-2 flex-1" disabled={loading}>
                    Maybe Later
                </button>
                <button onClick={handleUpgrade} className="interactive-primary flex items-center justify-center gap-2 flex-1 py-2" disabled={loading}>
                    <FaCrown className="mr-2" size={14} />
                    {loading ? 'Loading...' : 'Subscribe Now'}
                </button>
            </div>

            <p className="text-center text-xs text-text-muted mt-4">
                Secure payment processed by Stripe
            </p>
        </Modal>
    );
}
