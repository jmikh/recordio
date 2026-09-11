import { create } from 'zustand';

/**
 * Transient auth-transport state. Deliberately NOT persisted — unlike
 * useUserStore this describes the current tab's connection to the auth
 * server, and a stale value from a previous session would be worse than
 * no value at all.
 */
interface AuthStatusState {
    /**
     * The auth server couldn't be reached on the last token refresh.
     * Set from the transport (see supabase/client.ts) because auth-js
     * emits no event for this case.
     */
    authServerUnreachable: boolean;
    setAuthServerUnreachable: (unreachable: boolean) => void;
}

export const useAuthStatusStore = create<AuthStatusState>()(set => ({
    authServerUnreachable: false,
    setAuthServerUnreachable: (authServerUnreachable) => set({ authServerUnreachable }),
}));
