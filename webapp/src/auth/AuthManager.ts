import { type Session } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';
import { useUserStore } from '../editor/stores/useUserStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { supabase, setUnauthorizedHandler } from '../supabase/client';
import { captureError } from '../utils/sentry';
import { trackSigninFailed } from '../core/analytics';

// Re-export so existing callers keep working.
export { supabase };

/** Cache a remote avatar URL as a data URL to avoid CORS issues on reload */
async function cacheAvatarUrl(url: string): Promise<string | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

/** Sync session user data + avatar to the store */
async function syncUserToStore(session: Session) {
    const { setUser } = useUserStore.getState();
    const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
    const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
    const rawPicture = avatar_url || picture || null;

    // Skip avatar fetch if we already cached this source URL
    const cached = useUserStore.getState();
    let userPicture: string | null;
    if (rawPicture && cached.pictureSourceUrl === rawPicture) {
        userPicture = cached.picture;
    } else {
        // Set pictureSourceUrl immediately so subsequent rapid
        // onAuthStateChange callbacks see the match and skip (prevents 429s)
        setUser(session.user.id, session.user.email || '', userName, null, rawPicture);
        userPicture = rawPicture ? await cacheAvatarUrl(rawPicture) : null;
    }

    setUser(session.user.id, session.user.email || '', userName, userPicture, rawPicture);
}

/** Fetch user profile (trial info) via RPC and sync to store */
async function fetchProfile() {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.rpc('user_profile_get');
        if (!error && data) {
            useUserStore.getState().setTrialEndsAt(
                data.trial_ends_at ? new Date(data.trial_ends_at) : null
            );
        }
    } catch {
        // Profile table not configured yet
    }
}

/** Load default workspace + its subscription and sync both to the workspace store */
async function loadDefaultWorkspace(userId: string) {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.rpc('workspace_get_default');
        if (!error && data) {
            useWorkspaceStore.getState().setWorkspace(
                data.id, data.name, data.owner_id,
                data.role, data.seats ?? null,
            );
        }
    } catch {
        // Workspace table not configured yet
        return;
    } finally {
        useWorkspaceStore.getState().setWorkspaceReady();
    }

    try {
        const workspaceId = useWorkspaceStore.getState().workspaceId;
        const { data, error } = await supabase.rpc('subscription_get', {
            p_workspace_id: workspaceId ?? null,
        });
        if (!error && data) {
            useWorkspaceStore.getState().setSubscription({
                status: data.status,
                plan: data.plan ?? 'pro',
                currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
                cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
                billingInterval: data.billing_interval || null,
                seats: data.seats ?? null,
                stripeCustomerId: data.stripe_customer_id ?? null,
            }, userId);
        } else if (!data) {
            // No subscription for this workspace — reset to free
            useWorkspaceStore.getState().setSubscription({
                status: null,
                plan: 'pro',
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                billingInterval: null,
                seats: null,
                stripeCustomerId: null,
            }, userId);
        }
    } catch {
        // Subscription table not configured yet
    }
}

export class AuthManager {
    private static initialized = false;
    private static subscriptionFetchedForUserId: string | null = null;
    private static readyResolve: () => void;

    /** Resolves once the initial auth session has been processed. */
    static ready: Promise<void> = new Promise(r => { AuthManager.readyResolve = r; });

    /**
     * Initialize auth once for the entire SPA lifecycle.
     * Listens for auth state changes and syncs user + subscription to the store.
     * Safe to call multiple times — only the first call takes effect.
     */
    static init() {
        if (AuthManager.initialized) return;
        AuthManager.initialized = true;

        if (!supabase) {
            console.warn('[Auth] Supabase not configured - auth features disabled');
            AuthManager.readyResolve();
            return;
        }

        setUnauthorizedHandler(() => AuthManager.signOut());

        let firstEvent = true;
        supabase.auth.onAuthStateChange((event, session) => {
            console.log(`[Auth] onAuthStateChange: ${event}, session: ${session ? session.user.id : 'null'}`);

            if (firstEvent) {
                firstEvent = false;
                if (session) {
                    // Sync basic user info synchronously so isAuthenticated is set,
                    // but don't resolve ready yet — wait for workspace to load first.
                    const { setUser } = useUserStore.getState();
                    const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                    const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                    setUser(session.user.id, session.user.email || '', userName, avatar_url || picture || null, avatar_url || picture || null);
                } else {
                    // No session — nothing to load, unblock immediately.
                    AuthManager.readyResolve();
                }
            }

            // Full sync (avatar caching, workspace + subscription fetch) runs in background.
            // handleSession calls readyResolve() once the workspace is loaded.
            AuthManager.handleSession(session);
        });
    }

    private static async handleSession(session: Session | null) {
        if (session) {
            Sentry.setUser({ id: session.user.id, email: session.user.email ?? undefined });
            await syncUserToStore(session);

            if (AuthManager.subscriptionFetchedForUserId !== session.user.id) {
                AuthManager.subscriptionFetchedForUserId = session.user.id;
                try {
                    await Promise.all([fetchProfile(), loadDefaultWorkspace(session.user.id)]);
                } finally {
                    // Resolve ready after workspace is loaded (or failed) so the
                    // dashboard never renders before the correct workspace is set.
                    AuthManager.readyResolve();
                }
            }
        } else {
            Sentry.setUser(null);
            AuthManager.subscriptionFetchedForUserId = null;
            useUserStore.getState().clearUser();
            useWorkspaceStore.getState().clearWorkspace();
        }
    }

    /**
     * Force re-fetch workspace + subscription from DB (e.g. after Stripe checkout).
     */
    static async refreshSubscription() {
        const userId = useUserStore.getState().userId;
        if (userId) {
            await loadDefaultWorkspace(userId);
        }
    }

    /**
     * Sign out
     */
    static async signOut() {
        if (!supabase) {
            return;
        }

        // Try global sign-out to invalidate the server-side session.
        // Fall back gracefully if the session is already gone (e.g. after db reset).
        const { error } = await supabase.auth.signOut({ scope: 'global' });
        if (error) console.warn('[Auth] signOut error (session may already be gone):', error.message);

        // Belt-and-suspenders: wipe all Supabase auth keys from localStorage
        // in case the SDK missed any (e.g. on version quirks or storage race).
        Object.keys(localStorage)
            .filter(k => k.startsWith('sb-'))
            .forEach(k => localStorage.removeItem(k));
    }

    /**
     * Get current session
     */
    static async getSession() {
        if (!supabase) {
            return null;
        }

        const { data: { session } } = await supabase.auth.getSession();
        return session;
    }

    /**
     * Get current user
     */
    static async getUser() {
        if (!supabase) {
            return null;
        }

        const { data: { user } } = await supabase.auth.getUser();
        return user;
    }

    /**
     * Email/password sign in or sign up (dev/local only).
     * Automatically creates the account if it doesn't exist yet.
     */
    static async signInWithEmail(email: string, password: string): Promise<{ error: Error | null }> {
        if (!supabase) return { error: new Error('Supabase not configured') };

        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (!signInError) return { error: null };

        const msg = signInError.message.toLowerCase();
        const notFound = msg.includes('invalid login credentials') || msg.includes('user not found');
        if (!notFound) return { error: signInError as Error };

        // Account doesn't exist yet — try to create it
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (!signUpError) return { error: null };

        // signUp said "already registered" → account exists but password is wrong
        if (signUpError.message.toLowerCase().includes('already registered')) {
            return { error: new Error('Incorrect password.') };
        }

        return { error: signUpError as Error };
    }

    /**
     * OAuth sign in (Google, GitHub, etc.)
     * Uses standard browser redirect flow
     */
    static async signInWithProvider(provider: 'google' | 'github'): Promise<{ data: any; error: Error | null }> {
        if (!supabase) {
            return { data: null, error: new Error('Supabase not configured') };
        }

        try {
            // Strip hash fragment to avoid ##access_token double-hash on redirect back
            const redirectTo = window.location.origin + window.location.pathname + window.location.search;

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo,
                    queryParams: {
                        prompt: 'select_account',
                    },
                },
            });

            if (error) {
                captureError(error, { flow: 'auth', phase: 'oauth', extra: { provider } });
                trackSigninFailed({
                    provider,
                    error: error.message,
                    error_name: error.name,
                    is_offline: !navigator.onLine,
                });
                return { data: null, error };
            }

            // Browser will redirect automatically to the OAuth provider
            return { data, error: null };
        } catch (error: any) {
            captureError(error, { flow: 'auth', phase: 'oauth', extra: { provider } });
            trackSigninFailed({
                provider,
                error: error?.message || 'Unknown error',
                error_name: error?.name,
                is_offline: !navigator.onLine,
            });
            return { data: null, error: error as Error };
        }
    }
}
