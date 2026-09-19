import { describe, it, expect } from 'vitest';
import { deriveLibraryCounts } from './libraryCounts';
import type { ProjectListItem } from '../../storage/cloudProjectService';

function project(over: Partial<ProjectListItem>): ProjectListItem {
    return {
        id: 'p', name: 'P', thumbnail: null, thumbnailStoragePath: null, updatedAt: '', createdAt: '',
        lastAccessedAt: null, ownerId: 'me', deletedAt: null, isShared: false, cloudVersion: 1,
        durationMs: null, shareSlug: 'slug', sharePolicy: 'private', workspaceAccess: null,
        isEditor: false, editorRole: null, uploadStatus: 'ready', mediaPaths: null,
        ...over,
    };
}

describe('deriveLibraryCounts', () => {
    it('shows pending projects under Yours but keeps them out of the cap count', () => {
        const counts = deriveLibraryCounts([
            project({ id: 'ready' }),
            project({ id: 'pending', uploadStatus: 'pending', mediaPaths: [] }),
            project({ id: 'theirs', ownerId: 'other', sharePolicy: 'workspace' }),
            project({ id: 'trashed', deletedAt: '2026-01-01' }),
        ], [], 'me');

        expect(counts).toEqual({
            yoursCount: 2,
            workspaceCount: 1,
            trashCount: 1,
            ownedProjectCount: 1,
            ownedScreenshotCount: 0,
        });
    });
});
