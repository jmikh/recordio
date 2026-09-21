import type { ReactNode } from 'react';
import { Button } from '@shared/components';
import { UserMenu } from '../../components/UserMenu';

interface DashboardTopBarProps {
    /** Current view, top left — "Yours", "Trash", "Workspace settings"… */
    title: string;
    isAuthenticated: boolean;
    onOpenSupport: () => void;
    onOpenAuthModal: () => void;
    /** Centered in the bar — the library's search box; settings pages leave it empty */
    children?: ReactNode;
    /** Second row on the same surface — the library's kind tabs + sort */
    bottom?: ReactNode;
}

/**
 * Floating top bar shared by every dashboard view — the same surface as the
 * editor header (`#editor-header`) but flush against the sidebar and top
 * edge: view title top left, account menu / sign-in top right, an optional
 * slot centered, and an optional second row beneath.
 */
export function DashboardTopBar({ title, isAuthenticated, onOpenSupport, onOpenAuthModal, children, bottom }: DashboardTopBarProps) {
    return (
        <div className="bg-surface border-b border-border flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none">
            <div className="h-header flex items-center px-4 justify-between relative">
                <h1 className="heading-2 truncate">{title}</h1>

                {children && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                        {children}
                    </div>
                )}

                {isAuthenticated ? (
                    <UserMenu onOpenSupportModal={onOpenSupport} />
                ) : (
                    <Button variant="ghost" onClick={onOpenAuthModal}>
                        Sign In
                    </Button>
                )}
            </div>

            {bottom && (
                <div className="px-4">
                    {bottom}
                </div>
            )}
        </div>
    );
}
