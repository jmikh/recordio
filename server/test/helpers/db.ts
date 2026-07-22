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
            (id, created_by, owner_id, workspace_id, name, project_data, slug, share_policy, deleted_at, expires_at)
         VALUES ($1, $2, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        [id, ownerId, workspaceId, name, JSON.stringify(opts.projectData ?? {}), slug, opts.sharePolicy === undefined ? 'public' : opts.sharePolicy, opts.deletedAt ?? null, opts.expiresAt ?? null],
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
    opts: { ownerId?: string; name?: string; deletedAt?: string | null } = {},
): Promise<SeededWorkspace> {
    const id = randomUUID();
    const ownerId = opts.ownerId ?? SEEDED_USER_ID;
    await db.query(
        'INSERT INTO workspaces (id, name, owner_id, deleted_at) VALUES ($1, $2, $3, $4)',
        [id, opts.name ?? 'Test workspace', ownerId, opts.deletedAt ?? null],
    );
    return { id, ownerId };
}

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
    plan?: 'pro' | 'teams';
    status?: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    billingInterval?: 'monthly' | 'yearly' | null;
    /** Constraint: seats only allowed when plan = 'teams' */
    seats?: number | null;
    stripeEventAt?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
}

export async function seedSubscription(db: Db, opts: SeedSubscriptionOptions): Promise<void> {
    await db.query(
        `INSERT INTO subscriptions
            (workspace_id, user_id, plan, status, stripe_customer_id, stripe_subscription_id, billing_interval, seats, stripe_event_at, current_period_end, cancel_at_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
            opts.workspaceId,
            opts.userId ?? SEEDED_USER_ID,
            opts.plan ?? 'pro',
            opts.status ?? 'active',
            opts.stripeCustomerId === undefined ? `cus_test_${randomUUID().slice(0, 8)}` : opts.stripeCustomerId,
            opts.stripeSubscriptionId === undefined ? `sub_test_${randomUUID().slice(0, 8)}` : opts.stripeSubscriptionId,
            opts.billingInterval === undefined ? 'monthly' : opts.billingInterval,
            opts.seats ?? null,
            opts.stripeEventAt ?? null,
            opts.currentPeriodEnd ?? null,
            opts.cancelAtPeriodEnd ?? false,
        ],
    );
}

/** workspace_members and subscriptions rows cascade with their workspace. */
export async function deleteWorkspaces(db: Db, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [ids]);
}

export interface SeedUserAssetOptions {
    userId?: string;
    assetType?: 'background' | 'music';
    status?: 'pending' | 'ready';
    isDeleted?: boolean;
    name?: string | null;
    sizeBytes?: number;
}

/** `user_assets.id` is TEXT (the edge fn stored a stringified uuid). */
export async function seedUserAsset(db: Db, opts: SeedUserAssetOptions = {}): Promise<string> {
    const id = randomUUID();
    const userId = opts.userId ?? SEEDED_USER_ID;
    const assetType = opts.assetType ?? 'background';
    await db.query(
        `INSERT INTO user_assets
            (id, user_id, asset_type, storage_path, name, size_bytes, status, is_deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            id,
            userId,
            assetType,
            `${userId}/assets/${id}.bin`,
            opts.name === undefined ? 'seed-asset' : opts.name,
            opts.sizeBytes ?? 1024,
            opts.status ?? 'ready',
            opts.isDeleted ?? false,
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
