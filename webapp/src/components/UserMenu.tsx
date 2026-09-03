import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuUser, LuLogOut, LuEllipsis } from 'react-icons/lu';
import { MdLightMode, MdDarkMode, MdOutlineBugReport } from 'react-icons/md';
import { useUserStore } from '../auth/useUserStore';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useThemeStore } from '../theme/useThemeStore';
import { AuthManager } from '../auth/AuthManager';
import { navigate } from '../lib/navigate';

interface UserMenuProps {
    onOpenSupportModal?: () => void;
    openDirection?: 'up' | 'down';
    /** 'avatar' = compact avatar button (editor header); 'row' = full-width name + email row (sidebar) */
    variant?: 'avatar' | 'row';
}

export function UserMenu({ onOpenSupportModal, openDirection = 'down', variant = 'avatar' }: UserMenuProps) {
    const { email, name, picture } = useUserStore();
    const { theme, setTheme } = useThemeStore();
    const isDark = theme === 'dark';

    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [portalPos, setPortalPos] = useState({ top: 0, left: 0 });

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSignOut = async () => {
        await AuthManager.signOut();
        useUserStore.getState().clearUser();
        useWorkspaceStore.getState().clearWorkspace();
        setIsOpen(false);
        navigate('/');
    };

    const handleToggle = () => {
        if (!isOpen && openDirection === 'up' && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setPortalPos({ top: rect.top, left: rect.left });
        }
        setIsOpen(!isOpen);
    };

    const menuContent = (
        <div className="p-4 border-b border-border bg-surface-elevated/50">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full overflow-hidden border border-border shrink-0">
                    {picture ? (
                        <img src={picture} alt={name || 'User'} className="w-full h-full object-cover" onError={() => useUserStore.getState().setUser(useUserStore.getState().userId!, email || '', name, null, null)} />
                    ) : (
                        <div className="w-full h-full bg-surface-light flex items-center justify-center text-text-muted">
                            <LuUser className="icon-md" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-text-highlighted truncate">{name || 'Recordio User'}</p>
                    <p className="text-xs text-text-muted truncate">{email}</p>
                </div>
            </div>
        </div>
    );

    const menuActions = (
        <div className="p-1.5 space-y-0.5">
            <button
                onClick={() => { setTheme(isDark ? 'light' : 'dark'); }}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-state-hover rounded-md transition-colors text-left"
            >
                {isDark
                    ? <MdLightMode className="icon-sm text-text-muted" />
                    : <MdDarkMode className="icon-sm text-text-muted" />
                }
                {isDark ? 'Light Mode' : 'Dark Mode'}
            </button>

            {onOpenSupportModal && (
                <button
                    onClick={() => { setIsOpen(false); onOpenSupportModal(); }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-main hover:text-text-highlighted hover:bg-state-hover rounded-md transition-colors text-left"
                >
                    <MdOutlineBugReport className="icon-sm text-text-muted" />
                    Report a Bug
                </button>
            )}

            <div className="h-px bg-border mx-2 my-1" />

            <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-muted hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors text-left"
            >
                <LuLogOut className="icon-sm" />
                Sign Out
            </button>
        </div>
    );

    const avatarImage = picture ? (
        <img src={picture} alt={name || 'User'} className="w-full h-full object-cover" onError={() => useUserStore.getState().setUser(useUserStore.getState().userId!, email || '', name, null, null)} />
    ) : (
        <div className="w-full h-full bg-surface-raised flex items-center justify-center text-text-muted">
            <LuUser className="icon-sm" />
        </div>
    );

    return (
        <div className="relative" ref={openDirection === 'down' ? menuRef : undefined}>
            {variant === 'row' ? (
                <button
                    ref={buttonRef}
                    onClick={handleToggle}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-state-hover transition-colors cursor-pointer text-left"
                    aria-label="Account menu"
                >
                    <div className="w-7 h-7 rounded-full overflow-hidden border border-border shrink-0">
                        {avatarImage}
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                        <p className="text-sm text-text-highlighted truncate">{name || 'Recordio User'}</p>
                        <p className="text-xs text-text-muted truncate">{email}</p>
                    </div>
                    <LuEllipsis className="icon-md text-text-muted shrink-0" />
                </button>
            ) : (
                <button
                    ref={buttonRef}
                    onClick={handleToggle}
                    className="w-8 h-8 rounded-full overflow-hidden border border-border hover:border-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 relative"
                    title={name || email || 'User Menu'}
                >
                    {avatarImage}
                </button>
            )}

            {isOpen && openDirection === 'down' && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-surface-raised border border-border rounded-lg shadow-xl z-[var(--z-index-dropdown)] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    {menuContent}
                    {menuActions}
                </div>
            )}

            {isOpen && openDirection === 'up' && createPortal(
                <div
                    ref={menuRef}
                    className="fixed w-64 bg-surface-raised border border-border rounded-lg shadow-xl z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-bottom-left"
                    style={{ bottom: window.innerHeight - portalPos.top + 8, left: portalPos.left }}
                >
                    {menuContent}
                    {menuActions}
                </div>,
                document.body
            )}
        </div>
    );
}
