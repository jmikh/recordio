import { useEffect } from 'react';
import { AuthManager, supabase } from '../auth/AuthManager';
import { useUserStore } from '../editor/stores/useUserStore';

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

/**
 * Shared auth state listener hook.
 * Initializes Supabase onAuthStateChange and syncs user/subscription data to the store.
 * Use in any top-level page component (editor App, dashboard, etc.).
 */
export function useAuthListener() {
    useEffect(() => {
        AuthManager.initAuthListener(async (session) => {
            const { setUser, setSubscription, clearUser } = useUserStore.getState();

            if (session) {
                const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                const rawPicture = avatar_url || picture || null;

                // Skip fetch if we already initiated a cache for this source URL.
                // The UI uses initials as a fallback while the data URL loads.
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

                // Fetch subscription status (includes free trial as status: 'trialing')
                if (supabase) {
                    try {
                        const { data, error } = await supabase
                            .from('subscriptions')
                            .select('*')
                            .eq('user_id', session.user.id)
                            .maybeSingle();

                        if (!error && data) {
                            setSubscription({
                                status: data.status,
                                planId: data.plan_id,
                                currentPeriodEnd: new Date(data.current_period_end),
                                cancelAtPeriodEnd: data.cancel_at_period_end,
                                stripeCustomerId: data.stripe_customer_id,
                                billingInterval: data.billing_interval || null
                            });
                        }
                    } catch {
                        // Subscription table not configured yet
                    }
                }
            } else {
                clearUser();
            }
        });
    }, []);
}
