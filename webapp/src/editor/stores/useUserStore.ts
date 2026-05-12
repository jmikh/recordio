import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { identifyUser, setUserProfileOnce, resetUser } from '../../core/analytics';

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

    // Actions
    setUser: (userId: string, email: string, name?: string | null, picture?: string | null, pictureSourceUrl?: string | null) => void;
    setTrialEndsAt: (trialEndsAt: Date | null) => void;
    clearUser: () => void;

    // Helper methods
    hasFreeTrial: () => boolean;
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

            // Actions
            setUser: (userId, email, name = null, picture = null, pictureSourceUrl = null) => {
                const wasAuthenticated = get().isAuthenticated;
                set({
                    userId,
                    email,
                    name,
                    picture,
                    pictureSourceUrl,
                    isAuthenticated: true,
                });
                identifyUser(userId);
                if (!wasAuthenticated) {
                    setUserProfileOnce(email);
                }
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
                });
            },

            // Helper to check if user has an active free trial (from user_profiles.trial_ends_at)
            hasFreeTrial: () => {
                const { isAuthenticated, trialEndsAt } = get();
                if (!isAuthenticated) return false;
                if (!trialEndsAt) return false;
                return new Date(trialEndsAt).getTime() > Date.now();
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
