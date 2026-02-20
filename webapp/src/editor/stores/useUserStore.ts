import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ExportQuality = '480p' | '720p' | '1080p' | '2K' | '4K';
export type ExportFps = 30 | 60;

const DEV_PRO_UID = import.meta.env.VITE_DEV_PRO_UID as string | undefined;
export type Theme = 'light' | 'dark';

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
    isAuthenticated: boolean;

    // Subscription state
    subscription: Subscription;
    isPro: boolean; // Computed from subscription.status

    // Free export credit
    freeCreditsUsed: number; // 0 = credit available, 1+ = used

    // Theme preference
    theme: Theme;

    // Actions
    setUser: (userId: string, email: string, name?: string | null, picture?: string | null) => void;
    setSubscription: (subscription: Subscription) => void;
    setFreeCreditsUsed: (count: number) => void;
    setTheme: (theme: Theme) => void;
    clearUser: () => void;

    // Helper methods
    canExportQuality: (quality: ExportQuality) => boolean;
    canExportFps: (fps: ExportFps) => boolean;
    hasFreeExportCredit: () => boolean;
}

export const useUserStore = create<UserState>()(
    persist(
        (set, get) => ({
            // Initial state
            userId: null,
            email: null,
            name: null,
            picture: null,
            isAuthenticated: false,
            subscription: {
                status: null,
                planId: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                stripeCustomerId: null
            },
            isPro: false,
            freeCreditsUsed: 0,
            theme: 'dark',

            // Actions
            setUser: (userId, email, name = null, picture = null) => {
                const isDevPro = DEV_PRO_UID ? userId === DEV_PRO_UID : false;
                set({
                    userId,
                    email,
                    name,
                    picture,
                    isAuthenticated: true,
                    ...(isDevPro ? { isPro: true } : {})
                });
            },

            setSubscription: (subscription) => {
                const state = get();
                const isDevPro = DEV_PRO_UID ? state.userId === DEV_PRO_UID : false;
                set({
                    subscription,
                    isPro: isDevPro || subscription.status === 'active' || subscription.status === 'trialing'
                });
            },

            setFreeCreditsUsed: (count) => set({ freeCreditsUsed: count }),

            setTheme: (theme) => {
                // Apply theme class to document
                if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
                set({ theme });
            },

            clearUser: () => set({
                userId: null,
                email: null,
                name: null,
                picture: null,
                isAuthenticated: false,
                subscription: {
                    status: null,
                    planId: null,
                    currentPeriodEnd: null,
                    cancelAtPeriodEnd: false,
                    stripeCustomerId: null
                },
                isPro: false,
                freeCreditsUsed: 0
            }),

            // Helper to check if user has a free export credit available
            hasFreeExportCredit: () => {
                const { isAuthenticated, isPro, freeCreditsUsed } = get();
                return isAuthenticated && !isPro && freeCreditsUsed === 0;
            },

            // Helper to check if user can export at quality
            canExportQuality: (quality: ExportQuality) => {
                const { isPro, hasFreeExportCredit } = get();

                // Free users can export 480p and 720p (with watermark)
                if (quality === '480p' || quality === '720p') {
                    return true;
                }

                // Pro users or users with free credit can export 1080p, 2K, and 4K
                return isPro || hasFreeExportCredit();
            },

            // Helper to check if user can export at fps
            canExportFps: (fps: ExportFps) => {
                const { isPro, hasFreeExportCredit } = get();
                if (fps === 30) return true;
                return isPro || hasFreeExportCredit();
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
                subscription: state.subscription,
                theme: state.theme
            }),
            onRehydrateStorage: () => (state) => {
                // Apply persisted theme on load (default is dark)
                if (state?.theme !== 'light') {
                    document.documentElement.classList.add('dark');
                }
            }
        }
    )
);
