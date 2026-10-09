import type { SupabaseUser } from '../ports/supabaseApi.js';

/**
 * The name a public share page shows for its owner: profile full_name,
 * then name, then email, then 'Unknown' (also for a failed lookup).
 */
export function ownerDisplayName(owner: SupabaseUser | null): string {
    const meta = owner?.userMetadata ?? {};
    return String(meta.full_name ?? meta.name ?? owner?.email ?? 'Unknown');
}
