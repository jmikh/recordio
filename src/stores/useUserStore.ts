import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ExportQuality = '360p' | '720p' | '1080p' | '4K';

export interface Subscription {
    status: 'active' | 'canceled' | 'past_due' | 'trialing' | null;
    planId: string | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
}

export interface UserState {
    // Auth state
    userId: string | null;
    email: string | null;
    isAuthenticated: boolean;

    // Subscription state
    subscription: Subscription;
    isPro: boolean; // Computed from subscription.status

    // Actions
    setUser: (userId: string, email: string) => void;
    setSubscription: (subscription: Subscription) => void;
    clearUser: () => void;

    // Helper method
    canExportQuality: (quality: ExportQuality) => boolean;
}

export const useUserStore = create<UserState>()(
    persist(
        (set, get) => ({
            // Initial state
            userId: null,
            email: null,
            isAuthenticated: false,
            subscription: {
                status: null,
                planId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                stripeCustomerId: null
            },
            isPro: false,

            // Actions
            setUser: (userId, email) => set({
                userId,
                email,
                isAuthenticated: true
            }),

            setSubscription: (subscription) => set({
                subscription,
                isPro: subscription.status === 'active' || subscription.status === 'trialing'
            }),

            clearUser: () => set({
                userId: null,
                email: null,
                isAuthenticated: false,
                subscription: {
                    status: null,
                    planId: null,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    stripeCustomerId: null
                },
                isPro: false
            }),

            // Helper to check if user can export at quality
            canExportQuality: (quality: ExportQuality) => {
                const { isPro } = get();

                // Free users can export 360p and 720p (with watermark)
                if (quality === '360p' || quality === '720p') {
                    return true;
                }

                // Only pro users can export 1080p and 4K
                return isPro;
            }
        }),
        {
            name: 'recordio-user-storage',
            // Only persist certain fields
            partialize: (state) => ({
                userId: state.userId,
                email: state.email,
                subscription: state.subscription
            })
        }
    )
);
