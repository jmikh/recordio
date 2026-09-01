import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { identifyUser, setUserProfileOnce, resetUser } from '../analytics';

export interface UserState {
    // Auth state
    userId: string | null;
    email: string | null;
    name: string | null;
    picture: string | null;
    pictureSourceUrl: string | null; // Original remote URL that was cached into `picture`
    isAuthenticated: boolean;

    // Actions
    setUser: (userId: string, email: string, name?: string | null, picture?: string | null, pictureSourceUrl?: string | null) => void;
    clearUser: () => void;
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
                identifyUser(email);
                if (!wasAuthenticated) {
                    setUserProfileOnce(email);
                }
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
                });
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
