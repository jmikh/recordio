import { LuLayoutGrid, LuShare2, LuTrash2, LuPlus } from 'react-icons/lu';
import { MdOutlineBugReport } from 'react-icons/md';
import { Button } from '@shared/components';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { UserMenu } from '../../components/UserMenu';
import { WorkspaceDropdown } from '../../components/WorkspaceDropdown';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import type { WorkspaceListItem } from '../../workspace/useWorkspaceStore';

export type DashboardView = 'all' | 'published' | 'trash';

const FREE_PROJECT_LIMIT = 5;

interface DashboardSidebarProps {
    activeView: DashboardView;
    onViewChange: (view: DashboardView) => void;
    projectCount: number;
    hasNonFreeAccess: boolean;
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
    onOpenWorkspaceSettings: () => void;
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
    hasNonFreeAccess,
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
    onOpenWorkspaceSettings,
}: DashboardSidebarProps) {

    const libraryItems: NavItem[] = [
        { icon: LuLayoutGrid, label: 'All Recordings', view: 'all', count: projectCount },
        { icon: LuShare2, label: 'Published', view: 'published', count: publishedCount },
        { icon: LuTrash2, label: 'Trash', view: 'trash', count: trashCount },
    ];

    return (
        <aside className="w-60 shrink-0 border-r border-border bg-surface hidden md:flex flex-col">
            {/* Workspace */}
            <div className="px-4 pt-4 pb-3">
                <WorkspaceDropdown
                    workspaces={workspaces}
                    currentWorkspaceId={currentWorkspaceId}
                    currentWorkspaceName={currentWorkspaceName}
                    currentRole={currentRole}
                    onSwitch={onSwitchWorkspace}
                    onOpenSettings={onOpenWorkspaceSettings}
                />
            </div>

            {/* New Recording */}
            <div className="px-4 pb-2">
                <Button variant="primary" size="sm" icon={LuPlus} onClick={onRecord} className="w-full">
                    New recording
                </Button>
            </div>

            {/* Scrollable middle — bottom bar stays pinned */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {/* Library */}
                <div className="px-2 mt-2">
                    <span className="text-[11px] text-text-muted uppercase tracking-wider px-3 mb-1 block">
                        Library
                    </span>
                    <nav className="flex flex-col gap-0.5 mt-1">
                        {libraryItems.map(item => {
                            const isActive = item.view != null && item.view === activeView;
                            return (
                                <button
                                    key={item.label}
                                    type="button"
                                    onClick={() => item.view && onViewChange(item.view)}
                                    className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-left ${
                                        isActive
                                            ? 'bg-primary/10 text-primary font-medium'
                                            : 'text-text-main hover:bg-state-hover'
                                    }`}
                                >
                                    <item.icon className="icon-sm shrink-0" />
                                    <span className="flex-1 truncate">{item.label}</span>
                                    {item.count !== undefined && (
                                        <span className={`text-xs ${isActive ? 'text-primary' : 'text-text-muted'}`}>
                                            {item.count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                {/* Free plan usage */}
                {!hasNonFreeAccess && (
                    <div className="mx-3 mt-4 px-3 py-3 bg-surface-raised rounded-[var(--radius-md)] border border-border">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-text-main">
                                {projectCount} of {FREE_PROJECT_LIMIT} projects used
                            </span>
                        </div>
                        <div className="h-1.5 bg-state-inactive rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${
                                    projectCount >= FREE_PROJECT_LIMIT ? 'bg-destructive' : 'bg-primary'
                                }`}
                                style={{ width: `${Math.min((projectCount / FREE_PROJECT_LIMIT) * 100, 100)}%` }}
                            />
                        </div>
                        {projectCount >= FREE_PROJECT_LIMIT && (
                            <>
                                <p className="text-[11px] text-text-muted mt-1.5">
                                    Upgrade to Pro for unlimited projects
                                </p>
                                <TrialExtendLink label="or extend free trial" className="mt-1 text-[11px]" />
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Bottom */}
            <div className="px-3 py-3 border-t border-border flex items-center gap-1">
                <Button variant="icon" icon={MdOutlineBugReport} onClick={onOpenSupport} title="Report a Bug" />
                <ThemeToggle />
                <div className="flex-1" />
                {isAuthenticated ? (
                    <UserMenu openDirection="up" />
                ) : (
                    <Button variant="ghost" size="sm" onClick={onOpenAuthModal}>
                        Sign In
                    </Button>
                )}
            </div>
        </aside>
    );
}
