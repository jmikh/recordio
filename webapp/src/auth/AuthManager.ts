import { createClient, type Session } from '@supabase/supabase-js';
import { useUserStore } from '../editor/stores/useUserStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

// These will be set via environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create Supabase client (only if env vars are set)
export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

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
                data.role, data.is_personal, data.seats ?? null,
            );
        }
    } catch {
        // Workspace table not configured yet
        return;
    }

    try {
        const { data, error } = await supabase.rpc('subscription_get');
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

        let firstEvent = true;
        supabase.auth.onAuthStateChange((event, session) => {
            console.log(`[Auth] onAuthStateChange: ${event}, session: ${session ? session.user.id : 'null'}`);

            // Resolve ready on the first event so components can start querying.
            // Don't await handleSession — avatar caching and subscription fetch
            // can finish in the background.
            if (firstEvent) {
                firstEvent = false;
                if (session) {
                    // Sync basic user info synchronously so isAuthenticated is set
                    const { setUser } = useUserStore.getState();
                    const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                    const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                    setUser(session.user.id, session.user.email || '', userName, avatar_url || picture || null, avatar_url || picture || null);
                }
                AuthManager.readyResolve();
            }

            // Full sync (avatar caching, subscription fetch) runs in background
            AuthManager.handleSession(session);
        });
    }

    private static async handleSession(session: Session | null) {
        if (session) {
            await syncUserToStore(session);

            if (AuthManager.subscriptionFetchedForUserId !== session.user.id) {
                AuthManager.subscriptionFetchedForUserId = session.user.id;
                await Promise.all([fetchProfile(), loadDefaultWorkspace(session.user.id)]);
            }
        } else {
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

        await supabase.auth.signOut();
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
                console.error('[Auth] OAuth error:', error);
                return { data: null, error };
            }

            // Browser will redirect automatically to the OAuth provider
            return { data, error: null };
        } catch (error) {
            console.error('[Auth] OAuth error:', error);
            return { data: null, error: error as Error };
        }
    }
}
