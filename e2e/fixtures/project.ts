/**
 * Seeds a real, editor-openable project through the same paths the app uses:
 *
 *   1. sign in the e2e user via Supabase auth REST (password grant)
 *   2. upload the fixture screen recording to the `project-media` bucket
 *      (service role — stands in for the tus upload the webapp performs)
 *   3. POST /project-create-v2 with a struct built by the app's own
 *      ProjectImpl.createFromSource (so schemaVersion/settings never drift)
 *   4. POST /project-confirm-upload to flip upload_status → 'ready'
 *      (loadProject rejects anything else)
 *
 * Runs in Node (Playwright test process), not the browser.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectImpl } from '../../webapp/src/core/Project';
import { cloudStoragePath } from '../../shared/utils/projectMedia';
import type { UserEvents } from '../../shared/types';
import { TEST_USER, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, API_URL } from './testUser';

const SCREEN_WEBM = path.join(import.meta.dirname, 'assets/screen.webm');
export const SCREEN_DURATION_MS = 2000; // matches the generated fixture video
export const SCREEN_SIZE = { width: 1280, height: 720 };

export const EMPTY_USER_EVENTS: UserEvents = {
    mouseClicks: [],
    mousePositions: [],
    keyboardEvents: [],
    drags: [],
    scrolls: [],
    typingEvents: [],
    urlChanges: [],
    hoveredCards: [],
};

async function jsonOrThrow(res: Response, what: string) {
    if (!res.ok) {
        throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

async function signIn(): Promise<{ token: string; userId: string }> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    const data = await jsonOrThrow(res, 'supabase password sign-in');
    return { token: data.access_token, userId: data.user.id };
}

async function api(route: string, token: string, body: unknown) {
    const res = await fetch(`${API_URL}/${route}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return jsonOrThrow(res, `POST /${route}`);
}

async function uploadScreenRecording(storagePath: string) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/project-media/${storagePath}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'video/webm',
            'x-upsert': 'true',
        },
        body: readFileSync(SCREEN_WEBM),
    });
    await jsonOrThrow(res, 'storage upload');
}

export interface SeededProject {
    projectId: string;
    name: string;
    workspaceId: string;
    cleanup: () => Promise<void>;
}

export async function seedProject(name = `e2e project ${randomUUID().slice(0, 8)}`): Promise<SeededProject> {
    const { token, userId } = await signIn();

    // Oldest workspace = the user's original/default one (workspace-list orders
    // created_at ASC on purpose — see server/src/routes/workspaces/workspaceList.ts)
    const { workspaces } = await api('workspace-list', token, {});
    if (!workspaces?.length) throw new Error('e2e user has no workspace — did auth.setup run?');
    const workspaceId = workspaces[0].id as string;

    const projectId = randomUUID();
    const storagePath = cloudStoragePath(userId, projectId, 'screen');
    await uploadScreenRecording(storagePath);

    const project = ProjectImpl.createFromSource(
        projectId,
        {
            storagePath,
            durationMs: SCREEN_DURATION_MS,
            hasAudio: false,
            size: SCREEN_SIZE,
        },
        EMPTY_USER_EVENTS,
    );

    await api('project-create-v2', token, { project, name, workspaceId });
    await api('project-confirm-upload', token, { projectId });

    const cleanup = async () => {
        // Best-effort: soft-delete the project row and remove the blob.
        await api('project-delete', token, { projectId }).catch(() => {});
        await fetch(`${SUPABASE_URL}/storage/v1/object/project-media/${storagePath}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
        }).catch(() => {});
    };

    return { projectId, name, workspaceId, cleanup };
}

/**
 * Best-effort removal of a project the app itself created during a test
 * (e.g. via the import flow) — mirrors seedProject's cleanup.
 */
export async function deleteProject(projectId: string): Promise<void> {
    const { token, userId } = await signIn();
    await api('project-delete', token, { projectId }).catch(() => {});
    const storagePath = cloudStoragePath(userId, projectId, 'screen');
    await fetch(`${SUPABASE_URL}/storage/v1/object/project-media/${storagePath}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
    }).catch(() => {});
}
