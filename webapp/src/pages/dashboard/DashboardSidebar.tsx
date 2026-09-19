import { LuBug, LuLayoutGrid, LuPanelLeftClose, LuPlus, LuSettings, LuTrash2, LuUserCog, LuUserPlus, LuUsers } from 'react-icons/lu';
import { Button, StatusBadge, LogoLink, SidebarNav, SidebarNavItem, type StatusBadgeVariant } from '@shared/components';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { UserMenu } from '../../components/UserMenu';
import { WorkspaceDropdown } from '../../components/WorkspaceDropdown';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import type { WorkspaceListItem } from '../../workspace/useWorkspaceStore';
import type { WorkspaceEntitlementsState } from '@shared/api/entitlements';

/** How each plan tier reads in the workspace card. */
const PLAN_BADGE: Record<WorkspaceEntitlementsState, { label: string; variant: StatusBadgeVariant }> = {
    free: { label: 'Free', variant: 'default' },
    trial: { label: 'Trial', variant: 'secondary' },
    pro: { label: 'Pro', variant: 'primary' },
};

export type DashboardView = 'all' | 'workspace' | 'trash' | 'settings' | 'personal';

interface DashboardSidebarProps {
    /** null = none highlighted, as when the sidebar is pulled out over the editor */
    activeView: DashboardView | null;
    onViewChange: (view: DashboardView) => void;
    /** Videos + screenshots owned by or shared directly with the caller; undefined hides the number */
    yoursCount?: number;
    /** Videos + screenshots shared within the workspace or publicly */
    workspaceCount?: number;
    /** The caller's own live projects — the set the free cap counts (Step 4) */
    ownedProjectCount: number;
    /** Server-sourced cap from entitlements; null = uncapped (trial/pro) */
    projectCap: number | null;
    /** The caller's own live screenshots — the separate free screenshot cap counts these */
    ownedScreenshotCount: number;
    screenshotCap: number | null;
    trashCount?: number;
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
    /**
     * Rendered inside the pulled-out NavDrawer rather than as the dashboard's
     * static column: always visible (no `md:` breakpoint), no right border, and
     * a collapse control beside the logo.
     */
    inDrawer?: boolean;
    onCollapse?: () => void;
}

interface NavItem {
    icon: typeof LuLayoutGrid;
    label: string;
    view?: DashboardView;
    count?: number;
}

/** Free-plan usage bar — cap and count come from the server (Step 4). */
function UsageMeter({ used, cap, noun, onOpenBilling }: { used: number; cap: number; noun: string; onOpenBilling: () => void }) {
    const atCap = used >= cap;
    return (
        <div className="mx-3 mt-4 px-3 py-3 bg-surface-raised rounded-[var(--radius-md)] border border-border">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-text-main">
                    {used} of {cap} {noun} used
                </span>
            </div>
            <div className="h-1.5 bg-state-inactive rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${atCap ? 'bg-destructive' : 'bg-primary'}`}
                    style={{ width: `${Math.min((used / cap) * 100, 100)}%` }}
                />
            </div>
            {atCap && (
                <>
                    <button
                        type="button"
                        onClick={onOpenBilling}
                        className="text-xs text-primary hover:underline mt-1.5 cursor-pointer block text-left"
                    >
                        Upgrade to Pro for unlimited {noun}
                    </button>
                    <TrialExtendLink label="or extend free trial" className="mt-1 text-xs" />
                </>
            )}
        </div>
    );
}

export function DashboardSidebar({
    activeView,
    onViewChange,
    yoursCount,
    workspaceCount,
    ownedProjectCount,
    projectCap,
    ownedScreenshotCount,
    screenshotCap,
    trashCount,
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
    inDrawer = false,
    onCollapse,
}: DashboardSidebarProps) {

    const libraryItems: NavItem[] = [
        { icon: LuLayoutGrid, label: 'Yours', view: 'all', count: yoursCount },
        { icon: LuUsers, label: 'Workspace', view: 'workspace', count: workspaceCount },
        { icon: LuTrash2, label: 'Trash', view: 'trash', count: trashCount },
    ];

    return (
        <aside
            className={inDrawer
                ? 'w-60 shrink-0 h-full bg-surface flex flex-col'
                : 'w-60 shrink-0 border-r border-border bg-surface hidden md:flex flex-col'}
        >
            {/* Logo */}
            <div className="px-3 pt-3 flex items-center justify-between gap-2">
                <Button
                    variant="ghost"
                    onClick={() => onViewChange('all')}
                    aria-label="Go to dashboard"
                    className="w-fit"
                >
                    <LogoLink imgClassName="h-6" />
                </Button>
                {onCollapse && (
                    <Button
                        variant="ghost"
                        icon={LuPanelLeftClose}
                        onClick={onCollapse}
                        aria-label="Close navigation"
                        title="Close navigation"
                    />
                )}
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
                    <StatusBadge variant={PLAN_BADGE[planState].variant} uppercase>{PLAN_BADGE[planState].label}</StatusBadge>
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

                {/* Manage — workspace settings for admins only (matches the old
                    dropdown gate); personal settings for everyone
                    (plans/user-default-project-settings) */}
                <div className="mt-4">
                    <span className="text-eyebrow px-4 mb-1 block">
                        Manage
                    </span>
                    <SidebarNav className="mt-1">
                        {currentRole === 'admin' && (
                            <SidebarNavItem
                                label="Workspace Settings"
                                active={activeView === 'settings'}
                                onClick={() => onViewChange('settings')}
                                icon={LuSettings}
                            />
                        )}
                        <SidebarNavItem
                            label="Personal Settings"
                            active={activeView === 'personal'}
                            onClick={() => onViewChange('personal')}
                            icon={LuUserCog}
                        />
                    </SidebarNav>
                </div>

                {/* Free plan usage — the two caps are independent (plans/screenshots) */}
                {projectCap != null && (
                    <UsageMeter used={ownedProjectCount} cap={projectCap} noun="projects" onOpenBilling={onOpenBilling} />
                )}
                {screenshotCap != null && (
                    <UsageMeter used={ownedScreenshotCount} cap={screenshotCap} noun="screenshots" onOpenBilling={onOpenBilling} />
                )}
            </div>

            {/* Bottom — account row; bug report + theme live inside the menu */}
            <div className="px-2 py-2 border-t border-border">
                {isAuthenticated ? (
                    <UserMenu openDirection="up" variant="row" onOpenSupportModal={onOpenSupport} />
                ) : (
                    <div className="flex items-center gap-1 px-1">
                        <Button variant="ghost" icon={LuBug} onClick={onOpenSupport} title="Report a Bug" />
                        <ThemeToggle />
                        <div className="flex-1" />
                        <Button variant="ghost" onClick={onOpenAuthModal}>
                            Sign In
                        </Button>
                    </div>
                )}
            </div>
        </aside>
    );
}
