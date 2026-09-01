/**
 * Real-Postgres helpers for e2e tests (plan: "Per-function testing").
 *
 * The pool points at the local `supabase start` Postgres via DATABASE_URL —
 * committed in the root `.env.test` (well-known local values) and loaded by
 * the ROOT vitest config. Running `vitest` from server/ directly won't load
 * it; e2e suites `describe.runIf(hasTestDb())` so only the root config (and
 * CI, which uses it) runs the merge-blocking tier.
 *
 * Isolation: builders generate unique ids/slugs per row and tests delete
 * what they created (`deleteProjects` — mux_videos cascade). Truncation is
 * deliberately NOT used: the root vitest run executes other e2e suites
 * against the same database in parallel, and truncating shared tables would
 * wipe the seed rows they depend on.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Db } from '../../src/deps.js';

/** Seeded by supabase/seed.sql (user1@gmail.com) — FK targets for owner/created_by. */
export const SEEDED_USER_ID = process.env.TEST_USER_PRO_ID ?? '11111111-1111-1111-1111-111111111111';

/** Second seeded user (user2@gmail.com) — for non-member/other-user cases. */
export const SEEDED_USER_2_ID = process.env.TEST_USER_TRIAL_ID ?? '22222222-2222-2222-2222-222222222222';

export function hasTestDb(): boolean {
    return Boolean(process.env.DATABASE_URL);
}

export function createTestPool(): pg.Pool {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL not set — run via the root vitest config (loads .env.test)');
    }
    return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
}

export interface SeededProject {
    id: string;
    slug: string | null;
    name: string;
    ownerId: string;
}

export interface SeedProjectOptions {
    ownerId?: string;
    name?: string;
    /** Pass null for a never-shared project (mux-video-create gates on slug) */
    slug?: string | null;
    sharePolicy?: string | null;
    deletedAt?: string | null;
    projectData?: unknown;
    /** Defaults to the owner's seeded personal workspace */
    workspaceId?: string;
    expiresAt?: string | null;
    /** Table default is 'pending'; project-list only returns 'ready' */
    uploadStatus?: 'pending' | 'ready';
    permanentlyDeleted?: boolean;
    cloudVersion?: number;
    updatedAt?: string;
}

export async function seedProject(db: Db, opts: SeedProjectOptions = {}): Promise<SeededProject> {
    const id = randomUUID();
    const ownerId = opts.ownerId ?? SEEDED_USER_ID;
    const slug = opts.slug === undefined ? `test-${randomUUID()}` : opts.slug;
    const name = opts.name ?? 'Test project';

    let workspaceId = opts.workspaceId;
    if (!workspaceId) {
        const { rows } = await db.query(
            'SELECT id FROM workspaces WHERE owner_id = $1 LIMIT 1',
            [ownerId],
        );
        workspaceId = (rows[0] as { id: string } | undefined)?.id;
        if (!workspaceId) throw new Error(`No seeded workspace for owner ${ownerId}`);
    }

    await db.query(
        `INSERT INTO projects
            (id, created_by, owner_id, workspace_id, name, project_data, slug, share_policy, deleted_at, expires_at, upload_status, permanently_deleted, cloud_version, updated_at)
         VALUES ($1, $2, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, COALESCE($10, 'pending'), $11, $12, COALESCE($13::timestamptz, now()))`,
        [id, ownerId, workspaceId, name, JSON.stringify(opts.projectData ?? {}), slug, opts.sharePolicy === undefined ? 'public' : opts.sharePolicy, opts.deletedAt ?? null, opts.expiresAt ?? null, opts.uploadStatus ?? null, opts.permanentlyDeleted ?? false, opts.cloudVersion ?? 1, opts.updatedAt ?? null],
    );
    return { id, slug, name, ownerId };
}

export interface SeedMuxVideoOptions {
    projectId: string;
    cloudVersion: number;
    status: 'pending' | 'completed' | 'failed' | 'canceled';
    userId?: string;
    muxPlaybackId?: string | null;
    muxAssetId?: string | null;
    renderStoragePath?: string | null;
    error?: string | null;
}

export async function seedMuxVideo(db: Db, opts: SeedMuxVideoOptions): Promise<string> {
    const id = randomUUID();
    await db.query(
        `INSERT INTO mux_videos
            (id, project_id, user_id, cloud_version, status, mux_playback_id, mux_asset_id, render_storage_path, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            id,
            opts.projectId,
            opts.userId ?? SEEDED_USER_ID,
            opts.cloudVersion,
            opts.status,
            opts.muxPlaybackId ?? null,
            opts.muxAssetId ?? null,
            opts.renderStoragePath ?? null,
            opts.error ?? null,
        ],
    );
    return id;
}

/**
 * Sets user_profiles.name (upsert — the signup trigger normally creates the
 * row) and returns the previous value so tests can RESTORE it in afterEach:
 * seeded users' profile rows are shared global state across parallel suites.
 */
export async function setUserProfileName(
    db: Db,
    userId: string,
    name: string | null,
): Promise<string | null> {
    const { rows } = await db.query('SELECT name FROM user_profiles WHERE user_id = $1', [userId]);
    const previous = (rows[0] as { name: string | null } | undefined)?.name ?? null;
    await db.query(
        `INSERT INTO user_profiles (user_id, name) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
        [userId, name],
    );
    return previous;
}

export async function seedProjectEditor(
    db: Db,
    opts: { projectId: string; userId: string },
): Promise<void> {
    await db.query(
        'INSERT INTO project_editors (project_id, user_id) VALUES ($1, $2)',
        [opts.projectId, opts.userId],
    );
}

/** mux_videos and project_editors rows cascade with their project. */
export async function deleteProjects(db: Db, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [ids]);
}

export interface SeededWorkspace {
    id: string;
    ownerId: string;
}

export async function seedWorkspace(
    db: Db,
    opts: { ownerId?: string; name?: string; deletedAt?: string | null; trialEndsAt?: string } = {},
): Promise<SeededWorkspace> {
    const id = randomUUID();
    const ownerId = opts.ownerId ?? SEEDED_USER_ID;
    // Trial defaults to long-expired (also against the unit tier's
    // 2026-01-01 fake clock) so seeded workspaces read as free — the
    // column default (now() + 7d) would grant every test workspace a
    // live trial. Trial-state tests pass an explicit trialEndsAt.
    await db.query(
        'INSERT INTO workspaces (id, name, owner_id, deleted_at, trial_ends_at) VALUES ($1, $2, $3, $4, $5)',
        [id, opts.name ?? 'Test workspace', ownerId, opts.deletedAt ?? null, opts.trialEndsAt ?? '2020-01-01T00:00:00Z'],
    );
    return { id, ownerId };
}

/**
 * Invited members only — the owner has NO workspace_members row since
 * revamp Step 2 (owner is its own state, workspaces.owner_id implies
 * admin). Don't seed the owner here; the prod model never has that row.
 */
export async function seedWorkspaceMember(
    db: Db,
    opts: { workspaceId: string; userId: string; role?: 'viewer' | 'creator' | 'admin' },
): Promise<void> {
    await db.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [opts.workspaceId, opts.userId, opts.role ?? 'admin'],
    );
}

export interface SeedSubscriptionOptions {
    workspaceId: string;
    userId?: string;
    status?: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    billingInterval?: 'monthly' | 'yearly' | null;
    /** NOT NULL with a >= 1 check since the single-plan migration */
    seats?: number;
    stripeEventAt?: string | null;
    currentPeriodEnd?: string | null;
    /** ISO timestamp of a scheduled cancellation; null/absent = renews */
    cancelAt?: string | null;
}

export async function seedSubscription(db: Db, opts: SeedSubscriptionOptions): Promise<void> {
    await db.query(
        `INSERT INTO subscriptions
            (workspace_id, user_id, status, stripe_customer_id, stripe_subscription_id, billing_interval, seats, stripe_event_at, current_period_end, cancel_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            opts.workspaceId,
            opts.userId ?? SEEDED_USER_ID,
            opts.status ?? 'active',
            opts.stripeCustomerId === undefined ? `cus_test_${randomUUID().slice(0, 8)}` : opts.stripeCustomerId,
            opts.stripeSubscriptionId === undefined ? `sub_test_${randomUUID().slice(0, 8)}` : opts.stripeSubscriptionId,
            opts.billingInterval === undefined ? 'monthly' : opts.billingInterval,
            opts.seats ?? 1,
            opts.stripeEventAt ?? null,
            opts.currentPeriodEnd ?? null,
            opts.cancelAt ?? null,
        ],
    );
}

/** workspace_members and subscriptions rows cascade with their workspace. */
export async function deleteWorkspaces(db: Db, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [ids]);
}

export interface SeededAuthUser {
    id: string;
    email: string;
}

/**
 * Dedicated auth.users row (mirrors seed.sql's insert) + user_profiles
 * row. Suites that mutate PER-USER state (default_workspace_id, profile
 * fields) use one of these instead of the shared seeded users — no
 * cross-suite contention, and "brand-new user" branches (e.g.
 * workspace-get-default's bootstrap) become directly testable.
 * Cleanup: deleteAuthUsers AFTER deleting the user's workspaces/projects.
 */
export async function seedAuthUser(
    db: Db,
    opts: { name?: string | null; withProfile?: boolean; keepBootstrapWorkspace?: boolean } = {},
): Promise<SeededAuthUser> {
    const id = randomUUID();
    const email = `test-${id.slice(0, 8)}@example.com`;
    await db.query(
        `INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, created_at, updated_at,
            raw_app_meta_data, raw_user_meta_data,
            confirmation_token, recovery_token, email_change_token_new,
            email_change_token_current, email_change, phone_change,
            phone_change_token, reauthentication_token,
            is_sso_user, is_anonymous
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', $1,
            'authenticated', 'authenticated', $2,
            '$2a$10$bGG9wO7.m4EdPm58tOuSd.TUuBLj3U/6KGCzOQTNjcTzGb4MHkz0G',
            NOW(), NOW(), NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
            '', '', '', '', '', '', '', '', false, false
        )`,
        [id, email],
    );
    // The signup trigger bootstraps a workspace + profile (revamp Step 2).
    // Drop the workspace by default so suites keep their "user with no
    // workspace yet" semantics and full control over what they seed;
    // trigger-behavior tests pass keepBootstrapWorkspace.
    if (!opts.keepBootstrapWorkspace) {
        await db.query('DELETE FROM workspaces WHERE owner_id = $1', [id]);
    }
    if (opts.withProfile === false) {
        // A signup trigger may have created one — the no-profile case needs it gone
        await db.query('DELETE FROM user_profiles WHERE user_id = $1', [id]);
    } else {
        await db.query(
            `INSERT INTO user_profiles (user_id, name) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
            [id, opts.name ?? null],
        );
    }
    return { id, email };
}

/** Defensively clears the user's dependent rows first (FK actions vary). */
export async function deleteAuthUsers(db: Db, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query('DELETE FROM workspace_invitations WHERE invited_by = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM workspace_members WHERE user_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM user_profiles WHERE user_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [ids]);
}

export interface SeedInvitationOptions {
    workspaceId: string;
    email: string;
    role?: 'viewer' | 'creator' | 'admin';
    invitedBy?: string;
    status?: 'pending' | 'accepted' | 'declined';
}

/** Invitations cascade with their workspace (deleteWorkspaces covers them). */
export async function seedWorkspaceInvitation(
    db: Db,
    opts: SeedInvitationOptions,
): Promise<{ id: string; token: string }> {
    const { rows } = await db.query(
        `INSERT INTO workspace_invitations
            (workspace_id, email, role, invited_by, token, status)
         VALUES ($1, lower($2), $3, $4, gen_random_uuid(), $5)
         RETURNING id, token`,
        [
            opts.workspaceId,
            opts.email,
            opts.role ?? 'creator',
            opts.invitedBy ?? SEEDED_USER_ID,
            opts.status ?? 'pending',
        ],
    );
    return rows[0] as { id: string; token: string };
}

export async function getDefaultWorkspaceId(db: Db, userId: string): Promise<string | null> {
    const { rows } = await db.query(
        'SELECT default_workspace_id AS id FROM user_profiles WHERE user_id = $1',
        [userId],
    );
    return (rows[0] as { id: string | null } | undefined)?.id ?? null;
}

export interface SeedUserAssetOptions {
    userId?: string;
    assetType?: 'background' | 'music';
    status?: 'pending' | 'ready';
    isDeleted?: boolean;
    name?: string | null;
    sizeBytes?: number;
    /** ISO timestamp — asset_list orders by created_at DESC */
    createdAt?: string;
}

/** `user_assets.id` is TEXT (the edge fn stored a stringified uuid). */
export async function seedUserAsset(db: Db, opts: SeedUserAssetOptions = {}): Promise<string> {
    const id = randomUUID();
    const userId = opts.userId ?? SEEDED_USER_ID;
    const assetType = opts.assetType ?? 'background';
    await db.query(
        `INSERT INTO user_assets
            (id, user_id, asset_type, storage_path, name, size_bytes, status, is_deleted, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
        [
            id,
            userId,
            assetType,
            `${userId}/assets/${id}.bin`,
            opts.name === undefined ? 'seed-asset' : opts.name,
            opts.sizeBytes ?? 1024,
            opts.status ?? 'ready',
            opts.isDeleted ?? false,
            opts.createdAt ?? null,
        ],
    );
    return id;
}

export async function deleteUserAssets(db: Db, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query('DELETE FROM user_assets WHERE id = ANY($1::text[])', [ids]);
}

export interface SeedRenderJobOptions {
    projectId: string;
    cloudVersion: number;
    status?: 'pending' | 'completed' | 'failed' | 'canceled';
    userId?: string;
    renderStoragePath?: string | null;
}

/** render_jobs rows cascade with their project (deleteProjects covers them). */
export async function seedRenderJob(db: Db, opts: SeedRenderJobOptions): Promise<string> {
    const id = randomUUID();
    await db.query(
        `INSERT INTO render_jobs (id, project_id, user_id, cloud_version, status, render_storage_path)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
            id,
            opts.projectId,
            opts.userId ?? SEEDED_USER_ID,
            opts.cloudVersion,
            opts.status ?? 'pending',
            opts.renderStoragePath === undefined
                ? `${opts.userId ?? SEEDED_USER_ID}/${opts.projectId}/renders/v${opts.cloudVersion}.mp4`
                : opts.renderStoragePath,
        ],
    );
    return id;
}
