import type { SupabaseApiPort, SupabaseUser } from '../../src/ports/supabaseApi.js';

export interface FakeSupabaseApi extends SupabaseApiPort {
    /** Seedable auth users, keyed by user id */
    users: Map<string, SupabaseUser>;
    /** Full storage paths currently "in the bucket"; seedable */
    storagePaths: Set<string>;
    removedPaths: string[];
}

export function createFakeSupabaseApi(): FakeSupabaseApi {
    const fake: FakeSupabaseApi = {
        users: new Map(),
        storagePaths: new Set(),
        removedPaths: [],

        async getUserById(userId) {
            return fake.users.get(userId) ?? null;
        },
        async listStorageObjects(prefix) {
            return [...fake.storagePaths]
                .filter((p) => p.startsWith(`${prefix}/`))
                .map((p) => p.slice(prefix.length + 1));
        },
        async removeStorageObjects(paths) {
            for (const path of paths) {
                fake.storagePaths.delete(path);
                fake.removedPaths.push(path);
            }
        },
    };
    return fake;
}
