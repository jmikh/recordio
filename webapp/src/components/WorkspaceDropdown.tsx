import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuCheck, LuSettings, LuChevronDown } from 'react-icons/lu';
import type { WorkspaceListItem } from '../workspace/useWorkspaceStore';

interface WorkspaceDropdownProps {
    workspaces: WorkspaceListItem[];
    currentWorkspaceId: string | null;
    currentWorkspaceName: string | null;
    currentRole: 'viewer' | 'creator' | 'admin' | null;
    onSwitch: (workspaceId: string) => void;
    onOpenSettings: () => void;
}

export function WorkspaceDropdown({
    workspaces,
    currentWorkspaceId,
    currentWorkspaceName,
    currentRole,
    onSwitch,
    onOpenSettings,
}: WorkspaceDropdownProps) {
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const openMenu = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
        }
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const isAdmin = currentRole === 'admin';

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={open ? () => setOpen(false) : openMenu}
                className="flex items-center gap-1.5 w-full group rounded-md px-2 py-1 hover:bg-state-hover transition-colors cursor-pointer"
            >
                <div className="flex flex-col flex-1 min-w-0 text-left overflow-hidden leading-tight">
                    <span className="text-[11px] text-text-muted">Workspace</span>
                    <span className="text-sm font-semibold text-text-highlighted truncate">{currentWorkspaceName ?? 'My Workspace'}</span>
                </div>
                <LuChevronDown className={`icon-sm shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[9999] bg-surface-raised border border-border rounded-lg shadow-float py-1 overflow-hidden"
                    style={{ top: menuPos.top, left: menuPos.left, minWidth: Math.max(menuPos.width, 200) }}
                >
                    {/* Workspace list */}
                    {workspaces.map(ws => (
                        <button
                            key={ws.id}
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                if (ws.id !== currentWorkspaceId) onSwitch(ws.id);
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-main hover:bg-state-hover cursor-pointer"
                        >
                            <div className="flex flex-col flex-1 min-w-0 text-left">
                                <span className="truncate">{ws.name}</span>
                            </div>
                            {ws.id === currentWorkspaceId && (
                                <LuCheck className="icon-sm text-primary shrink-0" />
                            )}
                        </button>
                    ))}

                    {/* Settings — visible for admins */}
                    {isAdmin && (
                        <>
                            <div className="h-px bg-border my-1" />
                            <button
                                type="button"
                                onClick={() => { setOpen(false); onOpenSettings(); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-main hover:bg-state-hover cursor-pointer"
                            >
                                <LuSettings className="icon-sm shrink-0 text-text-muted" />
                                Workspace Settings
                            </button>
                        </>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
