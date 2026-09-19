import type { ProjectListItem } from '../../storage/cloudProjectService';
import type { ScreenshotListItem } from '../../screenshot/screenshotService';

/**
 * The five numbers the sidebar shows. Derived in one place so the dashboard
 * and the pulled-out nav drawer can never drift apart on what "Yours" means.
 */
export interface LibraryCounts {
    /** Videos + screenshots owned by, or shared directly with, the caller */
    yoursCount: number;
    /** Videos + screenshots shared to the whole workspace or publicly */
    workspaceCount: number;
    /** The caller's own trashed videos + screenshots */
    trashCount: number;
    /** The caller's own live videos — what the free project cap counts */
    ownedProjectCount: number;
    /** The caller's own live screenshots — the separate free screenshot cap */
    ownedScreenshotCount: number;
}

export function deriveLibraryCounts(
    allProjects: ProjectListItem[],
    allScreenshots: ScreenshotListItem[],
    userId: string | null,
): LibraryCounts {
    const projects = allProjects.filter(p => !p.deletedAt);
    const screenshots = allScreenshots.filter(s => !s.deletedAt);

    const yourProjects = projects.filter(p => p.ownerId === userId || p.isEditor);
    const yourScreenshots = screenshots.filter(s => s.ownerId === userId);

    const isShared = (x: { sharePolicy: string | null }) =>
        x.sharePolicy === 'workspace' || x.sharePolicy === 'public';

    return {
        yoursCount: yourProjects.length + yourScreenshots.length,
        workspaceCount: projects.filter(isShared).length + screenshots.filter(isShared).length,
        trashCount:
            allProjects.filter(p => !!p.deletedAt && p.ownerId === userId).length
            + allScreenshots.filter(s => !!s.deletedAt && s.ownerId === userId).length,
        ownedProjectCount: projects.filter(p => p.ownerId === userId).length,
        ownedScreenshotCount: yourScreenshots.length,
    };
}
