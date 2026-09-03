import { LuLayoutGrid, LuShare2, LuTrash2, LuPlus, LuSettings, LuUsers, LuUserPlus } from 'react-icons/lu';
import { MdOutlineBugReport } from 'react-icons/md';
import { Button, ProBadge, LogoLink, SidebarNav, SidebarNavItem } from '@shared/components';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { UserMenu } from '../../components/UserMenu';
import { WorkspaceDropdown } from '../../components/WorkspaceDropdown';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import type { WorkspaceListItem } from '../../workspace/useWorkspaceStore';
import type { WorkspaceEntitlementsState } from '@shared/api/entitlements';

export type DashboardView = 'all' | 'workspace' | 'published' | 'trash' | 'settings';

interface DashboardSidebarProps {
    activeView: DashboardView;
    onViewChange: (view: DashboardView) => void;
    projectCount: number;
    /** Videos shared within the workspace or publicly */
    workspaceCount: number;
    /** The caller's own live projects — the set the free cap counts (Step 4) */
    ownedProjectCount: number;
    /** Server-sourced cap from entitlements; null = uncapped (trial/pro) */
    projectCap: number | null;
    trashCount: number;
    publishedCount: number;
    onRecord: () => void;
    isAuthenticated: boolean;
    onOpenSupport: () => void;
    onOpenAuthModal: () => void;
    workspaces: WorkspaceListItem[];
    currentWorkspaceId: string | null;
    currentWorkspaceName: string | null;
    currentRole: 'viewer' | 'creator' | 'admin' | null;
    onSwitchWorkspace: (workspaceId: string) => void;
    planState: WorkspaceEntitlementsState;
    /** Active member count from workspace-get; null while loading */
    memberCount: number | null;
    onInviteTeammates: () => void;
    onOpenBilling: () => void;
}

interface NavItem {
    icon: typeof LuLayoutGrid;
    label: string;
    view?: DashboardView;
    count?: number;
}

export function DashboardSidebar({
    activeView,
    onViewChange,
    projectCount,
    workspaceCount,
    ownedProjectCount,
    projectCap,
    trashCount,
    publishedCount,
    onRecord,
    isAuthenticated,
    onOpenSupport,
    onOpenAuthModal,
    workspaces,
    currentWorkspaceId,
    currentWorkspaceName,
    currentRole,
    onSwitchWorkspace,
    planState,
    memberCount,
    onInviteTeammates,
    onOpenBilling,
}: DashboardSidebarProps) {

    const libraryItems: NavItem[] = [
        { icon: LuLayoutGrid, label: 'Your Videos', view: 'all', count: projectCount },
        { icon: LuUsers, label: 'Workspace', view: 'workspace', count: workspaceCount },
        { icon: LuShare2, label: 'Published', view: 'published', count: publishedCount },
        { icon: LuTrash2, label: 'Trash', view: 'trash', count: trashCount },
    ];

    return (
        <aside className="w-60 shrink-0 border-r border-border bg-surface hidden md:flex flex-col">
            {/* Logo */}
            <div className="px-3 pt-3">
                <Button
                    variant="ghost"
                    onClick={() => onViewChange('all')}
                    aria-label="Go to dashboard"
                    className="w-fit"
                >
                    <LogoLink imgClassName="h-6" />
                </Button>
            </div>

            {/* Workspace card */}
            <div className="mx-3 mt-3 mb-3 border border-border rounded-[var(--radius-md)] bg-surface-raised shadow-sm">
                <div className="px-2 pt-1.5">
                    <WorkspaceDropdown
                        workspaces={workspaces}
                        currentWorkspaceId={currentWorkspaceId}
                        currentWorkspaceName={currentWorkspaceName}
                        onSwitch={onSwitchWorkspace}
                    />
                </div>
                <div className="flex items-center gap-2 px-4 pb-2.5 pt-0.5">
                    <ProBadge variant={planState} />
                    {memberCount != null && (
                        <span className="text-xs text-text-muted">
                            {memberCount} member{memberCount !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                {currentRole === 'admin' && (
                    <button
                        type="button"
                        onClick={onInviteTeammates}
                        className="w-full flex items-center gap-2 px-4 py-2 border-t border-border text-sm text-text-main hover:bg-state-hover transition-colors cursor-pointer rounded-b-[var(--radius-md)] text-left"
                    >
                        <LuUserPlus className="icon-sm text-text-muted shrink-0" />
                        Invite Teammates
                    </button>
                )}
            </div>

            {/* New Recording — bleeds from the left edge like the nav items (Loom-style) */}
            <div className="pr-3 pb-2">
                <Button variant="primary" icon={LuPlus} onClick={onRecord} className="w-full justify-start rounded-l-none rounded-r-lg pl-4">
                    New Recording
                </Button>
            </div>

            {/* Scrollable middle — bottom bar stays pinned */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {/* Library */}
                <div className="mt-2">
                    <span className="text-eyebrow px-4 mb-1 block">
                        Library
                    </span>
                    <SidebarNav className="mt-1">
                        {libraryItems.map(item => {
                            const isActive = item.view != null && item.view === activeView;
                            return (
                                <SidebarNavItem
                                    key={item.label}
                                    label={item.label}
                                    active={isActive}
                                    onClick={() => item.view && onViewChange(item.view)}
                                    icon={item.icon}
                                    trailing={item.count !== undefined && (
                                        <span className={`text-xs ${isActive ? 'text-primary' : 'text-text-muted'}`}>
                                            {item.count}
                                        </span>
                                    )}
                                />
                            );
                        })}
                    </SidebarNav>
                </div>

                {/* Manage — settings entry, admins only (matches the old dropdown gate) */}
                {currentRole === 'admin' && (
                    <div className="mt-4">
                        <span className="text-eyebrow px-4 mb-1 block">
                            Manage
                        </span>
                        <SidebarNav className="mt-1">
                            <SidebarNavItem
                                label="Workspace Settings"
                                active={activeView === 'settings'}
                                onClick={() => onViewChange('settings')}
                                icon={LuSettings}
                            />
                        </SidebarNav>
                    </div>
                )}

                {/* Free plan usage — cap and count come from the server (Step 4) */}
                {projectCap != null && (
                    <div className="mx-3 mt-4 px-3 py-3 bg-surface-raised rounded-[var(--radius-md)] border border-border">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-text-main">
                                {ownedProjectCount} of {projectCap} projects used
                            </span>
                        </div>
                        <div className="h-1.5 bg-state-inactive rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${
                                    ownedProjectCount >= projectCap ? 'bg-destructive' : 'bg-primary'
                                }`}
                                style={{ width: `${Math.min((ownedProjectCount / projectCap) * 100, 100)}%` }}
                            />
                        </div>
                        {ownedProjectCount >= projectCap && (
                            <>
                                <button
                                    type="button"
                                    onClick={onOpenBilling}
                                    className="text-xs text-primary hover:underline mt-1.5 cursor-pointer block text-left"
                                >
                                    Upgrade to Pro for unlimited projects
                                </button>
                                <TrialExtendLink label="or extend free trial" className="mt-1 text-xs" />
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom — account row; bug report + theme live inside the menu */}
            <div className="px-2 py-2 border-t border-border">
                {isAuthenticated ? (
                    <UserMenu openDirection="up" variant="row" onOpenSupportModal={onOpenSupport} />
                ) : (
                    <div className="flex items-center gap-1 px-1">
                        <Button variant="icon" icon={MdOutlineBugReport} onClick={onOpenSupport} title="Report a Bug" />
                        <ThemeToggle />
                        <div className="flex-1" />
                        <Button variant="ghost" size="sm" onClick={onOpenAuthModal}>
                            Sign In
                        </Button>
                    </div>
                )}
            </div>
        </aside>
    );
}
