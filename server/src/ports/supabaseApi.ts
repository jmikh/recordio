/**
 * Supabase platform APIs (service-role) — the small surface the edge
 * functions use beyond Postgres itself: auth admin user lookup
 * (send-workspace-invite, shared-video-get) and Storage REST on the
 * `project-media` bucket (purge-deleted-projects, mux-video-purge).
 *
 * Not covered here on purpose: JWT validation (local verify against
 * SUPABASE_JWT_SECRET — Step 1 auth plugin, no network) and signed download
 * URLs (self-generated via S3Port).
 */
export interface SupabaseUser {
    email?: string;
    /** full_name / name fallbacks for display names live in here */
    userMetadata: Record<string, unknown>;
}

export interface SupabaseApiPort {
    /** auth.admin.getUserById — null if not found */
    getUserById(userId: string): Promise<SupabaseUser | null>;
    /** storage list on project-media — returns object names under the prefix */
    listStorageObjects(prefix: string): Promise<string[]>;
    /** storage remove on project-media — full paths */
    removeStorageObjects(paths: string[]): Promise<void>;
}
