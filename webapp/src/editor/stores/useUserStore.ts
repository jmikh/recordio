import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { identifyUser, resetUser } from '../../core/analytics';

export type ExportQuality = '480p' | '720p' | '1080p' | '2K' | '4K';
export type ExportFps = 30 | 60;

const DEV_PRO_UID = import.meta.env.VITE_DEV_PRO_UID as string | undefined;

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
    name: string | null;
    picture: string | null;
    pictureSourceUrl: string | null; // Original remote URL that was cached into `picture`
    isAuthenticated: boolean;

    // Subscription state (includes free trial — status: 'trialing')
    subscription: Subscription;
    isPro: boolean; // Computed from subscription.status

    // Actions
    setUser: (userId: string, email: string, name?: string | null, picture?: string | null, pictureSourceUrl?: string | null) => void;
    setSubscription: (subscription: Subscription) => void;
    clearUser: () => void;

    // Helper methods
    canExportQuality: (quality: ExportQuality) => boolean;
    canExportFps: (fps: ExportFps) => boolean;
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
            subscription: {
                status: null,
                planId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                stripeCustomerId: null
            },
            isPro: false,

            // Actions
            setUser: (userId, email, name = null, picture = null, pictureSourceUrl = null) => {
                const isDevPro = DEV_PRO_UID ? userId === DEV_PRO_UID : false;
                set({
                    userId,
                    email,
                    name,
                    picture,
                    pictureSourceUrl,
                    isAuthenticated: true,
                    ...(isDevPro ? { isPro: true } : {})
                });
                identifyUser(userId, email);
            },

            setSubscription: (subscription) => {
                const state = get();
                const isDevPro = DEV_PRO_UID ? state.userId === DEV_PRO_UID : false;
                set({
                    subscription,
                    isPro: isDevPro || subscription.status === 'active' || subscription.status === 'trialing'
                });
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
                    subscription: {
                        status: null,
                        planId: null,
                        currentPeriodEnd: null,
                        cancelAtPeriodEnd: false,
                        stripeCustomerId: null
                    },
                    isPro: false,
                });
            },

            // Helper to check if user has an active free trial (now via subscriptions table)
            hasFreeTrial: () => {
                const { isAuthenticated, subscription } = get();
                if (!isAuthenticated) return false;
                if (subscription.status !== 'trialing') return false;
                // Check if trial hasn't expired (defense-in-depth — cron handles expiry server-side)
                if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() < Date.now()) return false;
                return true;
            },

            // Helper to check if user has pro access (subscription OR active trial)
            hasProAccess: () => {
                const { isPro, hasFreeTrial } = get();
                return isPro || hasFreeTrial();
            },

            // Helper to check if user can export at quality
            canExportQuality: (quality: ExportQuality) => {
                // Free users can export 480p and 720p (with watermark)
                if (quality === '480p' || quality === '720p') {
                    return true;
                }

                // Pro users or users with active trial can export 1080p, 2K, and 4K
                return get().hasProAccess();
            },

            // Helper to check if user can export at fps
            canExportFps: (fps: ExportFps) => {
                if (fps === 30) return true;
                return get().hasProAccess();
            }
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
                subscription: state.subscription
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Derive isAuthenticated from persisted userId (covers upgrade from before isAuthenticated was persisted)
                    if (state.userId && !state.isAuthenticated) {
                        useUserStore.setState({ isAuthenticated: true });
                    }
                }
            }
        }
    )
);
