/**
 * Personal default project settings — server access
 * (plans/user-default-project-settings §3.4).
 *
 * Thin wrapper over the three /user-project-defaults-* routes. The blob
 * shape and the resolve/strip logic live in webapp/src/core/projectDefaults.ts.
 */
import type { ProjectSettings } from '@shared/types';
import type { StoredProjectDefaults } from '@shared/api';
import { invokeFunction } from '../api/client';
import { captureError } from '../lib/sentry';
import { toStoredProjectDefaults } from '../core/projectDefaults';

export class UserDefaultsService {
    /**
     * The stored blob, or null when the user never saved defaults.
     * Throws on transport/server failure — the Personal Settings page
     * distinguishes "nothing saved" from "could not load".
     */
    static async fetch(): Promise<StoredProjectDefaults | null> {
        const { data, error } = await invokeFunction('user-project-defaults-get', {});
        if (error) throw error;
        return data ?? null;
    }

    /**
     * Import-path variant: any failure is reported and treated as "no
     * defaults" so a new project is never blocked by this read.
     */
    static async fetchOrNull(): Promise<StoredProjectDefaults | null> {
        try {
            return await this.fetch();
        } catch (err) {
            captureError(err, { flow: 'user_defaults', phase: 'fetch' });
            return null;
        }
    }

    /** Whole-blob replace of the user's defaults. Throws on failure. */
    static async save(settings: ProjectSettings): Promise<StoredProjectDefaults> {
        const stored = toStoredProjectDefaults(settings);
        const { error } = await invokeFunction('user-project-defaults-set', stored);
        if (error) throw error;
        return stored;
    }

    /** Back to the shipped defaults (column → NULL). Throws on failure. */
    static async clear(): Promise<void> {
        const { error } = await invokeFunction('user-project-defaults-clear', {});
        if (error) throw error;
    }
}
