/**
 * Integration tests for Supabase RPC functions.
 * Requires local Supabase running (`supabase start`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProClient, getTrialClient, adminClient, TEST_IDS } from '../helpers/supabaseClient';

let proClient: SupabaseClient;
let trialClient: SupabaseClient;

beforeAll(async () => {
    [proClient, trialClient] = await Promise.all([getProClient(), getTrialClient()]);
});

// ==========================================
// project_list
// ==========================================

describe('project_list', () => {
    it('returns only the calling user\'s projects', async () => {
        const { data, error } = await proClient.rpc('project_list');
        expect(error).toBeNull();
        const projects = data as any[];
        expect(projects.length).toBe(2); // minimal + full
        expect(projects.every((p: any) => typeof p.id === 'string')).toBe(true);
    });

    it('trial user sees only their project', async () => {
        const { data, error } = await trialClient.rpc('project_list');
        expect(error).toBeNull();
        const projects = data as any[];
        expect(projects.length).toBe(1);
        expect(projects[0].id).toBe(TEST_IDS.trialProjectId);
    });

    it('includes expected fields', async () => {
        const { data } = await proClient.rpc('project_list');
        const projects = data as any[];
        const p = projects.find((p: any) => p.id === TEST_IDS.fullProjectId);
        expect(p).toBeDefined();
        expect(p.name).toBe('Full Test Project');
        expect(p.cloud_version).toBe(3);
        expect(p.duration_ms).toBe(10000);
        expect(p.is_shared).toBe(false);
    });
});

// ==========================================
// project_update (optimistic concurrency)
// ==========================================

describe('project_update', () => {
    it('bumps cloud_version on data change', async () => {
        // Get current project data
        const { data: projects } = await proClient.rpc('project_list');
        const project = (projects as any[]).find((p: any) => p.id === TEST_IDS.minimalProjectId);
        const currentVersion = project.cloud_version;

        // Get full project data
        const { data: fullProject } = await adminClient
            .from('projects')
            .select('project_data')
            .eq('id', TEST_IDS.minimalProjectId)
            .single();

        // Modify project data slightly
        const modified = { ...fullProject!.project_data, _testMarker: Date.now() };

        const { data: newVersion, error } = await proClient.rpc('project_update', {
            p_project_id: TEST_IDS.minimalProjectId,
            p_project_data: modified,
            p_expected_version: currentVersion,
        });

        expect(error).toBeNull();
        expect(newVersion).toBe(currentVersion + 1);
    });

    it('returns same version when data is unchanged (hash match)', async () => {
        // Get current state
        const { data: row } = await adminClient
            .from('projects')
            .select('project_data, cloud_version')
            .eq('id', TEST_IDS.minimalProjectId)
            .single();

        const { data: version, error } = await proClient.rpc('project_update', {
            p_project_id: TEST_IDS.minimalProjectId,
            p_project_data: row!.project_data,
            p_expected_version: row!.cloud_version,
        });

        expect(error).toBeNull();
        expect(version).toBe(row!.cloud_version); // no bump
    });

    it('rejects stale version (optimistic concurrency conflict)', async () => {
        const { data: row } = await adminClient
            .from('projects')
            .select('project_data, cloud_version')
            .eq('id', TEST_IDS.minimalProjectId)
            .single();

        // Use a stale version (current - 1)
        const { data: version, error } = await proClient.rpc('project_update', {
            p_project_id: TEST_IDS.minimalProjectId,
            p_project_data: { ...row!.project_data, _staleTest: true },
            p_expected_version: row!.cloud_version - 1,
        });

        expect(error).toBeNull();
        expect(version).toBeNull(); // no row matched → null return
    });

    it('prevents cross-user updates', async () => {
        const { data: row } = await adminClient
            .from('projects')
            .select('project_data, cloud_version')
            .eq('id', TEST_IDS.minimalProjectId)
            .single();

        // Trial user tries to update pro user's project
        const { data: version } = await trialClient.rpc('project_update', {
            p_project_id: TEST_IDS.minimalProjectId,
            p_project_data: { ...row!.project_data, _hacked: true },
            p_expected_version: row!.cloud_version,
        });

        expect(version).toBeNull(); // user_id = auth.uid() doesn't match
    });
});

// ==========================================
// subscription_get
// ==========================================

describe('subscription_get', () => {
    it('returns pro user subscription as active', async () => {
        const { data, error } = await proClient.rpc('subscription_get');
        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data.status).toBe('active');
        expect(data.stripe_customer_id).toBe('cus_test_pro');
        expect(data.cancel_at).toBeNull();
    });

    it('returns trial user subscription as trialing', async () => {
        const { data, error } = await trialClient.rpc('subscription_get');
        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data.status).toBe('trialing');
        // Backfilled from the old cancel_at_period_end=true seed row
        expect(data.cancel_at).not.toBeNull();
    });
});

// ==========================================
// render_job_get_or_create
// ==========================================

describe('render_job_get_or_create', () => {
    let createdJobId: string;

    it('creates a new render job', async () => {
        const { data, error } = await proClient.rpc('render_job_get_or_create', {
            p_project_id: TEST_IDS.fullProjectId,
            p_user_id: TEST_IDS.proUserId,
            p_cloud_version: 3,
        });

        expect(error).toBeNull();
        expect(data).toHaveLength(1);
        const job = data[0];
        expect(job.status).toBe('pending');
        expect(job.is_new).toBe(true);
        expect(job.render_storage_path).toContain(TEST_IDS.fullProjectId);
        createdJobId = job.job_id;
    });

    it('deduplicates when called again with same version', async () => {
        const { data, error } = await proClient.rpc('render_job_get_or_create', {
            p_project_id: TEST_IDS.fullProjectId,
            p_user_id: TEST_IDS.proUserId,
            p_cloud_version: 3,
        });

        expect(error).toBeNull();
        const job = data[0];
        expect(job.job_id).toBe(createdJobId); // same job
        expect(job.is_new).toBe(false); // dedup, not new
        expect(job.status).toBe('pending');
    });

    it('returns completed job from cache', async () => {
        // Mark the job as completed via admin
        await adminClient
            .from('render_jobs')
            .update({
                status: 'completed',
                render_storage_path: `${TEST_IDS.proUserId}/${TEST_IDS.fullProjectId}/renders/v3.mp4`,
            })
            .eq('id', createdJobId);

        const { data } = await proClient.rpc('render_job_get_or_create', {
            p_project_id: TEST_IDS.fullProjectId,
            p_user_id: TEST_IDS.proUserId,
            p_cloud_version: 3,
        });

        const job = data[0];
        expect(job.status).toBe('completed');
        expect(job.is_new).toBe(false);
    });

    it('resets failed job to pending on retry', async () => {
        // Mark as failed
        await adminClient
            .from('render_jobs')
            .update({ status: 'failed', error: 'test error' })
            .eq('id', createdJobId);

        const { data } = await proClient.rpc('render_job_get_or_create', {
            p_project_id: TEST_IDS.fullProjectId,
            p_user_id: TEST_IDS.proUserId,
            p_cloud_version: 3,
        });

        const job = data[0];
        expect(job.status).toBe('pending');
        expect(job.is_new).toBe(true); // reset counts as new
    });

    afterAll(async () => {
        // Clean up render jobs created during tests
        await adminClient
            .from('render_jobs')
            .delete()
            .eq('project_id', TEST_IDS.fullProjectId);
    });
});

// ==========================================
// user_profile_get
// ==========================================

describe('user_profile_get', () => {
    it('returns the calling user profile', async () => {
        const { data, error } = await proClient.rpc('user_profile_get');
        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data.name).toBe('Pro User');
    });
});

// ==========================================
// project_delete / project_restore
// ==========================================

describe('project_delete and project_restore', () => {
    it('soft-deletes a project then restores it', async () => {
        // Delete
        const { error: delError } = await proClient.rpc('project_delete', {
            p_project_id: TEST_IDS.minimalProjectId,
        });
        expect(delError).toBeNull();

        // Verify deleted (deleted_at set, still in list with deleted_at)
        const { data: row } = await adminClient
            .from('projects')
            .select('deleted_at')
            .eq('id', TEST_IDS.minimalProjectId)
            .single();
        expect(row!.deleted_at).not.toBeNull();

        // Restore
        const { error: restoreError } = await proClient.rpc('project_restore', {
            p_project_id: TEST_IDS.minimalProjectId,
        });
        expect(restoreError).toBeNull();

        // Verify restored
        const { data: restored } = await adminClient
            .from('projects')
            .select('deleted_at')
            .eq('id', TEST_IDS.minimalProjectId)
            .single();
        expect(restored!.deleted_at).toBeNull();
    });
});
