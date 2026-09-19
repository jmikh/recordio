/**
 * One-off: backfill ownership metadata onto every Mux asset referenced by
 * mux_videos, then list (and with --delete, remove) Mux assets that carry
 * no metadata — i.e. assets our DB no longer knows about.
 *
 *   node --env-file=.env.prod node_modules/.bin/tsx scripts/muxBackfillMeta.ts            # backfill + dry-run orphans
 *   node --env-file=.env.prod node_modules/.bin/tsx scripts/muxBackfillMeta.ts --delete   # also delete orphans
 */
import pg from 'pg';
import { buildAssetMetaFields } from '../src/adapters/mux.js';

const DELETE = process.argv.includes('--delete');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');
const { DATABASE_URL, MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
if (!DATABASE_URL || !MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
    throw new Error('DATABASE_URL, MUX_TOKEN_ID, MUX_TOKEN_SECRET required');
}
const auth = `Basic ${Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString('base64')}`;
const BASE = 'https://api.mux.com';

async function mux(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? null : res.json();
}

interface Row {
    mux_video_id: string;
    mux_asset_id: string;
    project_id: string;
    user_id: string;
    cloud_version: number;
    workspace_id: string;
    name: string;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
try {
    const { rows } = await pool.query<Row>(`
        SELECT mv.id AS mux_video_id, mv.mux_asset_id, mv.project_id, mv.user_id,
               mv.cloud_version, p.workspace_id, p.name
        FROM mux_videos mv
        JOIN projects p ON p.id = mv.project_id
        WHERE mv.mux_asset_id IS NOT NULL
        ORDER BY mv.created_at`);
    const known = new Set(rows.map((r) => r.mux_asset_id));
    console.log(`DB: ${rows.length} mux_videos rows with a mux_asset_id`);

    // 1. Backfill
    if (!SKIP_BACKFILL) {
        for (const r of rows) {
            const fields = buildAssetMetaFields({
                projectId: r.project_id,
                workspaceId: r.workspace_id,
                creatorId: r.user_id,
                cloudVersion: r.cloud_version,
                title: r.name,
            });
            try {
                await mux('PATCH', `/video/v1/assets/${r.mux_asset_id}`, fields);
                console.log(`  updated ${r.mux_asset_id}  project=${r.project_id} v${r.cloud_version} "${r.name}"`);
            } catch (err) {
                console.log(`  FAILED  ${r.mux_asset_id}  ${(err as Error).message}`);
            }
        }
    }

    // 2. Walk every asset on Mux, find the ones with no metadata
    const orphans: any[] = [];
    let total = 0;
    for (let page = 1; ; page++) {
        const { data } = await mux('GET', `/video/v1/assets?limit=100&page=${page}`);
        if (!data.length) break;
        total += data.length;
        for (const a of data) {
            const hasMeta = Boolean(a.passthrough || a.meta?.external_id || a.meta?.creator_id);
            if (!hasMeta) orphans.push(a);
        }
    }
    console.log(`\nMux: ${total} assets total, ${orphans.length} without metadata${DELETE ? '' : ' (DRY RUN — nothing deleted)'}`);
    for (const a of orphans) {
        const inDb = known.has(a.id) ? 'IN DB (backfill failed?)' : 'not in DB';
        console.log(`  ${a.id}  created=${new Date(Number(a.created_at) * 1000).toISOString()}  status=${a.status}  dur=${Math.round(a.duration ?? 0)}s  ${inDb}`);
        if (DELETE) {
            if (known.has(a.id)) {
                console.log('    skipped delete: referenced by mux_videos');
                continue;
            }
            await mux('DELETE', `/video/v1/assets/${a.id}`);
            console.log('    deleted');
        }
    }
} finally {
    await pool.end();
}
