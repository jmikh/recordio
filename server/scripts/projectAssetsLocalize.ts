/**
 * One-off (plans/storage-download-permissions-oneshot.md): copy every
 * library asset a project still references by its library path into the
 * project's own namespace, and point project_data at the copy. project-get
 * only signs namespace paths (plus the caller's own prefix, the fallback
 * this script makes unnecessary), so until then a collaborator can't load
 * an owner's custom background/music.
 *
 * Each rewrite bumps cloud_version, so an editor open on the old data gets
 * the normal conflict reload instead of a save rejection, and is guarded
 * by the old path, so a save that landed in between isn't clobbered.
 * updated_at is left alone (it orders the dashboard).
 *
 *   node --env-file=.env.prod node_modules/.bin/tsx scripts/projectAssetsLocalize.ts           # dry run
 *   node --env-file=.env.prod node_modules/.bin/tsx scripts/projectAssetsLocalize.ts --apply   # copy + rewrite
 */
/* eslint-disable no-console -- a CLI script: stdout is its report */
import pg from 'pg';
import { createS3Adapter } from '../src/adapters/s3.js';
import { isProjectPath, projectAssetPath, storageFileName } from '../src/services/storagePaths.js';

const APPLY = process.argv.includes('--apply');
const { DATABASE_URL, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
if (!DATABASE_URL || !S3_REGION || !S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    throw new Error('DATABASE_URL, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY required');
}

const SLOTS = [
    { column: 'background', jsonPath: ['settings', 'background', 'storagePath'] },
    { column: 'music', jsonPath: ['settings', 'audio', 'music', 'storagePath'] },
] as const;

interface Row {
    id: string;
    created_by: string;
    background: string | null;
    music: string | null;
}

interface Rewrite {
    jsonPath: readonly string[];
    from: string;
    to: string;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const s3 = createS3Adapter({
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
});

/** jsonb_set per rewrite, guarded by every old value still being in place. */
async function rewrite(projectId: string, rewrites: Rewrite[]): Promise<boolean> {
    let expr = 'project_data';
    const guards: string[] = [];
    const params: unknown[] = [projectId];
    for (const r of rewrites) {
        params.push([...r.jsonPath], r.to, r.from);
        const [path, to, from] = [params.length - 2, params.length - 1, params.length];
        expr = `jsonb_set(${expr}, $${path}::text[], to_jsonb($${to}::text))`;
        guards.push(`project_data #>> $${path}::text[] = $${from}`);
    }
    const { rowCount } = await pool.query(
        `UPDATE projects
         SET project_data = ${expr}, cloud_version = cloud_version + 1
         WHERE id = $1 AND ${guards.join(' AND ')}`,
        params,
    );
    return rowCount === 1;
}

try {
    const { rows } = await pool.query(
        `SELECT id, created_by,
                project_data #>> '{settings,background,storagePath}'   AS background,
                project_data #>> '{settings,audio,music,storagePath}' AS music
         FROM projects
         WHERE permanently_deleted = false
           AND (project_data #>> '{settings,background,storagePath}' IS NOT NULL
             OR project_data #>> '{settings,audio,music,storagePath}' IS NOT NULL)`,
    );

    let pending = 0;
    let done = 0;
    let failed = 0;
    for (const row of rows as Row[]) {
        const rewrites: Rewrite[] = [];
        for (const slot of SLOTS) {
            const from = row[slot.column];
            if (!from || isProjectPath(from, row.id)) continue;
            rewrites.push({
                jsonPath: slot.jsonPath,
                from,
                to: projectAssetPath(row.created_by, row.id, storageFileName(from)),
            });
        }
        if (rewrites.length === 0) continue;

        pending++;
        for (const r of rewrites) console.log(`${row.id}  ${r.from}  ->  ${r.to}`);
        if (!APPLY) continue;

        try {
            for (const r of rewrites) await s3.copyObject(r.from, r.to);
            if (await rewrite(row.id, rewrites)) {
                done++;
            } else {
                console.log('    skipped: project_data changed meanwhile — rerun picks it up');
            }
        } catch (err) {
            failed++;
            console.log(`    FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    console.log(APPLY
        ? `\n${done} projects rewritten, ${failed} failed, ${pending - done - failed} skipped`
        : `\n${pending} projects to rewrite (DRY RUN — nothing copied or written; rerun with --apply)`);
} finally {
    await pool.end();
}
