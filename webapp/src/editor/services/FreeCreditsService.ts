import { supabase } from '../../auth/AuthManager';
import { useUserStore } from '../stores/useUserStore';

export class FreeCreditsService {
    /**
     * Consume one free export credit via the server-side edge function.
     * Returns { success } indicating whether the credit was consumed.
     */
    static async consumeFreeCredit(): Promise<{ success: boolean; error?: Error }> {
        if (!supabase) {
            return { success: false, error: new Error('Supabase not configured') };
        }

        try {
            const { data, error } = await supabase.functions.invoke('consume-free-credit', {
                body: {},
            });

            if (error) {
                console.error('[FreeCredits] Edge function error:', error);
                return { success: false, error };
            }

            if (data?.success) {
                // Update local store to reflect consumed credit
                useUserStore.getState().setFreeCreditsUsed(1);
                console.log('[FreeCredits] Credit consumed successfully');
                return { success: true };
            }

            console.log('[FreeCredits] Credit already used');
            return { success: false };
        } catch (error) {
            console.error('[FreeCredits] Unexpected error:', error);
            return { success: false, error: error as Error };
        }
    }
}
