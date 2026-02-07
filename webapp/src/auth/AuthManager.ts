import { createClient, type Session } from '@supabase/supabase-js';

// These will be set via environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create Supabase client (only if env vars are set)
export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export class AuthManager {
    /**
     * Initialize auth state listener
     * Call this once on app startup
     */
    static initAuthListener(callback: (session: Session | null) => void) {
        if (!supabase) {
            console.warn('[Auth] Supabase not configured - auth features disabled');
            return;
        }

        supabase.auth.onAuthStateChange((event, session) => {
            console.log('[Auth] State change:', event, session?.user?.email);
            callback(session);
        });
    }

    /**
     * Sign out
     */
    static async signOut() {
        if (!supabase) {
            return;
        }

        await supabase.auth.signOut();
        console.log('[Auth] Signed out');
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
     * OAuth sign in (Google, GitHub, etc.)
     * Uses standard browser redirect flow
     */
    static async signInWithProvider(provider: 'google' | 'github'): Promise<{ data: any; error: Error | null }> {
        if (!supabase) {
            return { data: null, error: new Error('Supabase not configured') };
        }

        try {
            console.log('[Auth] Starting OAuth with', provider);

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: window.location.href,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent',
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
