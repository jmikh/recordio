import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { identifyUser, setUserProfileOnce, resetUser } from '../../core/analytics';

export type ExportQuality = '480p' | '720p' | '1080p' | '2K' | '4K';

const DEV_PRO_UID = import.meta.env.VITE_DEV_PRO_UID as string | undefined;

export interface Subscription {
    status: 'active' | 'canceled' | 'past_due' | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
    billingInterval: 'monthly' | 'yearly' | null;
}

export interface UserState {
    // Auth state
    userId: string | null;
    email: string | null;
    name: string | null;
    picture: string | null;
    pictureSourceUrl: string | null; // Original remote URL that was cached into `picture`
    isAuthenticated: boolean;

    // Trial state (from user_profiles table)
    trialEndsAt: Date | null;

    // Subscription state (from subscriptions table — Stripe only)
    subscription: Subscription;
    isPro: boolean; // Computed from subscription.status

    // Actions
    setUser: (userId: string, email: string, name?: string | null, picture?: string | null, pictureSourceUrl?: string | null) => void;
    setSubscription: (subscription: Subscription) => void;
    setTrialEndsAt: (trialEndsAt: Date | null) => void;
    clearUser: () => void;

    // Helper methods
    canExportQuality: (quality: ExportQuality) => boolean;
    hasFreeTrial: () => boolean;
    hasProAccess: () => boolean;
}

export const useUserStore = create<UserState>()(
    persist(
        (set, get) => ({
            // Initial state
            userId: null,
            email: null,
            name: null,
            picture: null,
            pictureSourceUrl: null,
            isAuthenticated: false,
            trialEndsAt: null,
            subscription: {
                status: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                stripeCustomerId: null,
                billingInterval: null
            },
            isPro: false,

            // Actions
            setUser: (userId, email, name = null, picture = null, pictureSourceUrl = null) => {
                const isDevPro = DEV_PRO_UID ? userId === DEV_PRO_UID : false;
                const wasAuthenticated = get().isAuthenticated;
                set({
                    userId,
                    email,
                    name,
                    picture,
                    pictureSourceUrl,
                    isAuthenticated: true,
                    ...(isDevPro ? { isPro: true } : {})
                });
                identifyUser(userId);
                if (!wasAuthenticated) {
                    setUserProfileOnce(email);
                }
            },

            setSubscription: (subscription) => {
                const state = get();
                const isDevPro = DEV_PRO_UID ? state.userId === DEV_PRO_UID : false;
                set({
                    subscription,
                    isPro: isDevPro || subscription.status === 'active' || subscription.status === 'past_due'
                });
            },

            setTrialEndsAt: (trialEndsAt) => {
                set({ trialEndsAt });
            },

            clearUser: () => {
                resetUser();
                set({
                    userId: null,
                    email: null,
                    name: null,
                    picture: null,
                    pictureSourceUrl: null,
                    isAuthenticated: false,
                    trialEndsAt: null,
                    subscription: {
                        status: null,
                        currentPeriodEnd: null,
                        cancelAtPeriodEnd: false,
                        stripeCustomerId: null,
                        billingInterval: null
                    },
                    isPro: false,
                });
            },

            // Helper to check if user has an active free trial (from user_profiles.trial_ends_at)
            hasFreeTrial: () => {
                const { isAuthenticated, trialEndsAt } = get();
                if (!isAuthenticated) return false;
                if (!trialEndsAt) return false;
                return new Date(trialEndsAt).getTime() > Date.now();
            },

            // Helper to check if user has pro access (subscription OR active trial)
            hasProAccess: () => {
                const { isPro, hasFreeTrial } = get();
                return isPro || hasFreeTrial();
            },

            // Helper to check if user can export at quality
            canExportQuality: (quality: ExportQuality) => {
                // Free users can export 480p and 720p
                if (quality === '480p' || quality === '720p') {
                    return true;
                }

                // Pro users or users with active trial can export 1080p, 2K, and 4K
                return get().hasProAccess();
            },


        }),
        {
            name: 'recordio-user-storage',
            // Only persist certain fields
            partialize: (state) => ({
                userId: state.userId,
                email: state.email,
                name: state.name,
                picture: state.picture,
                pictureSourceUrl: state.pictureSourceUrl,
                isAuthenticated: state.isAuthenticated,
                trialEndsAt: state.trialEndsAt,
                subscription: state.subscription
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Derive isAuthenticated from persisted userId (covers upgrade from before isAuthenticated was persisted)
                    if (state.userId && !state.isAuthenticated) {
                        useUserStore.setState({ isAuthenticated: true });
                    }
                    // Re-derive isPro from persisted subscription (isPro itself is not persisted)
                    const isDevPro = DEV_PRO_UID ? state.userId === DEV_PRO_UID : false;
                    const status = state.subscription?.status;
                    if (isDevPro || status === 'active' || status === 'past_due') {
                        useUserStore.setState({ isPro: true });
                    }
                }
            }
        }
    )
);
