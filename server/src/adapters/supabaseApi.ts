/**
 * Real Supabase platform-API adapter (service role) — first landed with
 * shared-video-get, which needs auth admin user lookup for display names.
 *
 * Thin translation only (see server/README.md). The storage methods'
 * first consumers are the Wave C purge jobs — they land there, not
 * speculatively here.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseApiPort } from '../ports/supabaseApi.js';

export interface SupabaseApiAdapterConfig {
    url: string;
    serviceRoleKey: string;
}

export function createSupabaseApiAdapter(config: SupabaseApiAdapterConfig): SupabaseApiPort {
    const client = createClient(config.url, config.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    return {
        async getUserById(userId) {
            const { data, error } = await client.auth.admin.getUserById(userId);
            if (error) {
                if (error.status === 404) return null;
                throw new Error(`auth.admin.getUserById failed: ${error.message}`);
            }
            if (!data.user) return null;
            return {
                email: data.user.email,
                userMetadata: data.user.user_metadata ?? {},
            };
        },
        async listStorageObjects() {
            throw new Error('supabaseApi.listStorageObjects: lands with the Wave C purge jobs');
        },
        async removeStorageObjects() {
            throw new Error('supabaseApi.removeStorageObjects: lands with the Wave C purge jobs');
        },
    };
}
