/** The sections of the hidden admin surface and their paths (App routes on these). */
export type AdminSection = 'users' | 'projects' | 'subscribers' | 'growth';

export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
    users: '/admin',
    projects: '/admin/projects',
    subscribers: '/admin/subscribers',
    growth: '/admin/growth',
};

/** The section an /admin path names; unknown sub-paths fall back to Users. */
export function adminSectionFromPath(path: string): AdminSection {
    for (const section of ['projects', 'subscribers', 'growth'] as const) {
        if (path === ADMIN_SECTION_PATHS[section]) return section;
    }
    return 'users';
}
