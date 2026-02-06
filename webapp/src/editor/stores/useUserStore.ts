import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ExportQuality = '360p' | '720p' | '1080p' | '4K';
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

    // Theme preference
    theme: Theme;

    // Actions
    setUser: (userId: string, email: string, name?: string | null, picture?: string | null) => void;
    setSubscription: (subscription: Subscription) => void;
    setTheme: (theme: Theme) => void;
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
            theme: 'dark',

            // Actions
            setUser: (userId, email, name = null, picture = null) => set({
                userId,
                email,
                name,
                picture,
                isAuthenticated: true
            }),

            setSubscription: (subscription) => set({
                subscription,
                isPro: subscription.status === 'active' || subscription.status === 'trialing'
            }),

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
