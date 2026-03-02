import { useState, useEffect } from 'react';
import { FaCheck, FaGift } from 'react-icons/fa';
import { BiCrown } from 'react-icons/bi';
import { XButton, Modal } from '@shared/components';
import { StripeService } from '../../stripe/StripeService';
import { MAX_SHARED_VIDEOS } from '../../services/ShareService';
import { useUserStore } from '../../stores/useUserStore';
import { supabase } from '../../../auth/AuthManager';
import { trackUpgradeModalViewed, trackUpgradeModalDismissed, trackGetProClicked } from '../../../core/analytics';

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
        } else {
            trackUpgradeModalViewed();
        }
    }, [isOpen]);

    const handleClose = () => {
        trackUpgradeModalDismissed();
        onClose();
    };

    const handleUpgrade = async () => {
        if (!userId || !email) {
            onClose();
            onSignInRequest();
            return;
        }

        trackGetProClicked(billingInterval);
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
    const yearlyPrice = 72;
    const yearlyMonthlyEquivalent = Math.round(yearlyPrice / 12);
    const savingsPercent = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);

    return (
        <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[380px]">
            {/* Header */}
            <div className="flex justify-end mb-2">
                <XButton onClick={handleClose} title="Close" />
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

            {/* Pro Title */}
            <h2 className="text-2xl font-bold text-text-highlighted text-center mb-6 flex items-center justify-center gap-2">
                Recordio
                <span className="bg-primary text-text-on-primary text-xs font-bold px-2.5 py-1 rounded-full uppercase">
                    Pro
                </span>
            </h2>

            {/* Price Display */}
            <div className="text-center mb-2">
                <span className="text-5xl font-bold text-primary">
                    ${billingInterval === 'monthly' ? monthlyPrice : yearlyMonthlyEquivalent}
                </span>
            </div>
            <p className="text-sm text-text-muted text-center mb-1">
                per month
            </p>
            <p className="text-xs text-text-muted text-center mb-5">
                {billingInterval === 'yearly'
                    ? `Billed at $${yearlyPrice} annually`
                    : 'Billed monthly'
                }
            </p>

            {/* Billing Toggle — pill style */}
            <div className="flex items-center justify-center gap-1 mb-6 bg-surface rounded-full p-1 mx-auto w-fit">
                <button
                    onClick={() => setBillingInterval('monthly')}
                    className={`py-1.5 px-5 text-sm font-medium rounded-full transition-all ${billingInterval === 'monthly'
                        ? 'bg-primary text-text-on-primary shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Monthly
                </button>
                <button
                    onClick={() => setBillingInterval('yearly')}
                    className={`py-1.5 px-5 text-sm font-medium rounded-full transition-all ${billingInterval === 'yearly'
                        ? 'bg-primary text-text-on-primary shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Annual -{savingsPercent}%
                </button>
            </div>

            {/* Feature List */}
            <ul className="space-y-4 mb-6">
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted font-medium">Everything in Free, plus:</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">Unlimited 4K exports</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">No watermarks</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">Shareable links</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">Priority support</span>
                </li>
            </ul>

            {/* Free Trial Banner (non-authenticated users only) */}
            {!isAuthenticated && (
                <div className="mb-4 bg-primary/10 border border-primary/30 rounded-lg p-3 flex items-start gap-3">
                    <FaGift className="text-primary mt-0.5 shrink-0" size={16} />
                    <div>
                        <p className="text-sm text-text-highlighted">
                            <strong>Try Pro free for 7 days!</strong>
                        </p>
                        <p className="text-xs text-text-muted mt-0.5">
                            <button
                                onClick={() => { onClose(); onSignInRequest(); }}
                                className="text-primary hover:text-primary-highlighted underline"
                            >
                                Sign in
                            </button>
                            {' '}to start your free trial — no credit card needed.
                        </p>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mb-4 bg-red-900/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-sm text-xs">
                    {error}
                </div>
            )}

            {/* Get Pro Button */}
            <button
                onClick={handleUpgrade}
                className="interactive-primary flex items-center justify-center gap-2 w-full py-3 text-base font-semibold rounded-lg"
                disabled={loading}
            >
                {loading ? 'Loading...' : 'Get Pro'}
            </button>

            <p className="text-center text-xs text-text-muted mt-4">
                Secure payment processed by Stripe
            </p>
        </Modal>
    );
}
