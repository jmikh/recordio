import { createClient, type Session } from '@supabase/supabase-js';

// These will be set via environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

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
     * Sign in with email/password
     */
    static async signIn(email: string, password: string) {
        if (!supabase) {
            return { data: null, error: new Error('Supabase not configured') };
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error('[Auth] Sign in error:', error);
        } else {
            console.log('[Auth] Sign in successful:', data.user?.email);
        }

        return { data, error };
    }

    /**
     * Sign up with email/password
     */
    static async signUp(email: string, password: string) {
        if (!supabase) {
            return { data: null, error: new Error('Supabase not configured') };
        }

        console.log('[Auth] Attempting sign up for:', email);
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });

        if (error) {
            console.error('[Auth] Sign up error:', error.message, error);
        } else {
            console.log('[Auth] Sign up successful:', data.user?.email);

            if (data.user && !data.session) {
                console.warn('[Auth] ⚠️ Email confirmation required! Check your email inbox.');
            }

            if (data.session) {
                console.log('[Auth] ✅ User is logged in immediately (no email confirmation needed)');
            }
        }

        return { data, error };
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
     * Uses chrome.identity.launchWebAuthFlow for Chrome extensions
     */
    static async signInWithProvider(provider: 'google' | 'github'): Promise<{ data: any; error: Error | null }> {
        if (!supabase) {
            return { data: null, error: new Error('Supabase not configured') };
        }

        try {
            console.log('[Auth] Starting OAuth with', provider);

            // Chrome extensions use a special redirect URL format
            const redirectUrl = `https://${chrome.runtime.id}.chromiumapp.org/`;
            console.log('[Auth] Redirect URL:', redirectUrl);

            // Get OAuth URL from Supabase
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    skipBrowserRedirect: true,
                    redirectTo: redirectUrl,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent'  // Force Google to show consent screen
                    }
                }
            });

            if (error || !data.url) {
                console.error('[Auth] Failed to get OAuth URL:', error);
                return { data: null, error };
            }

            console.log('[Auth] Launching web auth flow...');

            // Launch OAuth flow using Chrome Identity API
            return new Promise((resolve) => {
                chrome.identity.launchWebAuthFlow(
                    {
                        url: data.url,
                        interactive: true
                    },
                    async (redirectUrl) => {
                        if (chrome.runtime.lastError) {
                            console.error('[Auth] OAuth error:', chrome.runtime.lastError);
                            resolve({
                                data: null,
                                error: new Error(chrome.runtime.lastError.message)
                            });
                            return;
                        }

                        if (!redirectUrl) {
                            resolve({ data: null, error: new Error('No redirect URL') });
                            return;
                        }

                        console.log('[Auth] OAuth callback received');

                        // Extract tokens from redirect URL hash
                        const url = new URL(redirectUrl);
                        const hashParams = new URLSearchParams(url.hash.substring(1));

                        const access_token = hashParams.get('access_token');
                        const refresh_token = hashParams.get('refresh_token');

                        if (!access_token) {
                            console.error('[Auth] No access token in redirect');
                            resolve({ data: null, error: new Error('No access token received') });
                            return;
                        }

                        console.log('[Auth] Tokens received, setting session...');

                        // Set the session using the tokens
                        const { error: sessionError } = await supabase.auth.setSession({
                            access_token,
                            refresh_token: refresh_token || ''
                        });

                        if (sessionError) {
                            console.error('[Auth] Failed to set session:', sessionError);
                            resolve({ data: null, error: sessionError });
                        } else {
                            console.log('[Auth] OAuth successful!');
                            resolve({ data, error: null });
                        }
                    }
                );
            });
        } catch (error) {
            console.error('[Auth] OAuth error:', error);
            return { data: null, error: error as Error };
        }
    }
}
