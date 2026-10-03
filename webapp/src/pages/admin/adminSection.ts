/** The sections of the hidden admin surface and their paths (App routes on these). */
export type AdminSection = 'users' | 'projects' | 'growth';

export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
    users: '/admin',
    projects: '/admin/projects',
    growth: '/admin/growth',
};

/** The section an /admin path names; unknown sub-paths fall back to Users. */
export function adminSectionFromPath(path: string): AdminSection {
    if (path === ADMIN_SECTION_PATHS.projects) return 'projects';
    if (path === ADMIN_SECTION_PATHS.growth) return 'growth';
    return 'users';
}
