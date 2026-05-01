import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LuLayoutGrid, LuStar, LuShare2, LuTrash2, LuFolder, LuPlus, LuEllipsis, LuPencil, LuTrash } from 'react-icons/lu';
import { MdOutlineBugReport } from 'react-icons/md';
import { LogoLink, Button, ThemeToggle, Modal, Tooltip } from '@shared/components';
import { UserMenu } from './UserMenu';
import type { CloudFolder } from '../storage/cloudStorage';

export type DashboardView = 'all' | 'starred' | 'published' | 'trash' | { folder: string };

interface DashboardSidebarProps {
    activeView: DashboardView;
    onViewChange: (view: DashboardView) => void;
    projectCount: number;
    starredCount: number;
    trashCount: number;
    publishedCount: number;
    folders: CloudFolder[];
    onCreateFolder: (name: string, description: string) => void;
    onEditFolder: (folderId: string, name: string, description: string) => void;
    onDeleteFolder: (folderId: string) => void;
    onRecord: () => void;
    isAuthenticated: boolean;
    onOpenSupport: () => void;
    onOpenUpgradeModal: () => void;
    onOpenAuthModal: () => void;
}

interface NavItem {
    icon: typeof LuLayoutGrid;
    label: string;
    view?: 'all' | 'starred' | 'published' | 'trash';
    count?: number;
}

export function DashboardSidebar({
    activeView,
    onViewChange,
    projectCount,
    starredCount,
    trashCount,
    publishedCount,
    folders,
    onCreateFolder,
    onEditFolder,
    onDeleteFolder,
    onRecord,
    isAuthenticated,
    onOpenSupport,
    onOpenUpgradeModal,
    onOpenAuthModal,
}: DashboardSidebarProps) {

    // Create folder modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderDescription, setNewFolderDescription] = useState('');

    // Edit folder modal
    const [editingFolder, setEditingFolder] = useState<CloudFolder | null>(null);
    const [editFolderName, setEditFolderName] = useState('');
    const [editFolderDescription, setEditFolderDescription] = useState('');

    // Context menu
    const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const libraryItems: NavItem[] = [
        { icon: LuLayoutGrid, label: 'All Recordings', view: 'all', count: projectCount },
        { icon: LuStar, label: 'Starred', view: 'starred', count: starredCount },
        { icon: LuShare2, label: 'Published', view: 'published', count: publishedCount },
        { icon: LuTrash2, label: 'Trash', view: 'trash', count: trashCount },
    ];


    // Create folder
    const handleCreateFolder = () => {
        const name = newFolderName.trim();
        if (!name) return;
        onCreateFolder(name, newFolderDescription.trim());
        setNewFolderName('');
        setNewFolderDescription('');
        setShowCreateModal(false);
    };

    const closeCreateModal = () => {
        setShowCreateModal(false);
        setNewFolderName('');
        setNewFolderDescription('');
    };

    // Edit folder
    const openEditModal = (folder: CloudFolder) => {
        setEditingFolder(folder);
        setEditFolderName(folder.name);
        setEditFolderDescription(folder.description);
        setMenuFolderId(null);
    };

    const handleEditFolder = () => {
        if (!editingFolder) return;
        const name = editFolderName.trim();
        if (!name) return;
        onEditFolder(editingFolder.id, name, editFolderDescription.trim());
        setEditingFolder(null);
    };

    const closeEditModal = () => {
        setEditingFolder(null);
        setEditFolderName('');
        setEditFolderDescription('');
    };

    // Context menu
    const openMenu = (e: React.MouseEvent, folderId: string) => {
        e.stopPropagation();
        const button = menuButtonRefs.current.get(folderId);
        if (button) {
            const rect = button.getBoundingClientRect();
            setMenuPosition({ top: rect.bottom + 4, left: rect.left });
        }
        setMenuFolderId(folderId);
    };

    useEffect(() => {
        if (!menuFolderId) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuFolderId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuFolderId]);

    const activeFolderId = typeof activeView === 'object' ? activeView.folder : null;

    const inputClassName = "w-full px-3 py-2 text-sm bg-surface border border-border rounded-[var(--radius-interactive)] text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    return (
        <aside className="w-60 shrink-0 border-r border-border bg-surface hidden md:flex flex-col h-screen sticky top-0 overflow-y-auto">
            {/* Logo */}
            <div className="px-4 pt-4 pb-2 flex justify-center">
                <LogoLink imgClassName="h-8" />
            </div>

            {/* New Recording */}
            <div className="px-3 py-3">
                <Button variant="primary" fullWidth icon={LuPlus} onClick={onRecord}>
                    New recording
                </Button>
            </div>

            {/* Library */}
            <div className="pl-0 pr-3 mt-2">
                <span className="text-[11px] text-text-muted uppercase tracking-wider px-4 mb-1 block">
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
                                className={`
                                    relative flex items-center gap-4 px-4 py-2 rounded-r-lg text-sm transition-colors w-full text-left cursor-pointer
                                    ${isActive
                                        ? 'bg-primary/15 text-primary'
                                        : 'text-text-main hover:bg-state-hover'
                                    }
                                `}
                            >
                                {isActive && (
                                    <span className="absolute left-0 inset-y-0 w-[3px] bg-primary rounded-r-sm" />
                                )}
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

            {/* Folders */}
            <div className="pl-0 pr-3 mt-6">
                <div className="flex items-center gap-1 px-4 mb-1">
                    <span className="text-[11px] text-text-muted uppercase tracking-wider">
                        Folders
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowCreateModal(true)}
                        className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
                        title="New folder"
                    >
                        <LuPlus className="icon-sm" />
                    </button>
                </div>
                <nav className="flex flex-col gap-0.5 mt-1">
                    {folders.map(folder => {
                        const isActive = activeFolderId === folder.id;
                        const folderRow = (
                            <div key={folder.id} className="group relative">
                                <button
                                    type="button"
                                    onClick={() => onViewChange({ folder: folder.id })}
                                    className={`
                                        relative flex items-center gap-4 px-4 py-2 rounded-r-lg text-sm transition-colors w-full text-left cursor-pointer
                                        ${isActive
                                            ? 'bg-primary/15 text-primary'
                                            : 'text-text-main hover:bg-state-hover'
                                        }
                                    `}
                                >
                                    {isActive && (
                                        <span className="absolute left-0 inset-y-0 w-[3px] bg-primary rounded-r-sm" />
                                    )}
                                    <LuFolder className="icon-sm shrink-0" />
                                    <span className="flex-1 truncate">{folder.name}</span>
                                    {/* Fixed-width slot: count or three-dots */}
                                    <span className="w-6 flex items-center justify-center shrink-0">
                                        <span className={`text-xs group-hover:hidden ${isActive ? 'text-primary' : 'text-text-muted'}`}>
                                            {folder.project_count}
                                        </span>
                                        <span
                                            ref={el => { if (el) menuButtonRefs.current.set(folder.id, el as unknown as HTMLButtonElement); }}
                                            role="button"
                                            tabIndex={0}
                                            onClick={e => { e.stopPropagation(); openMenu(e as unknown as React.MouseEvent, folder.id); }}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openMenu(e as unknown as React.MouseEvent, folder.id); } }}
                                            className="hidden group-hover:flex items-center justify-center text-text-muted hover:text-text-main cursor-pointer rounded-md"
                                        >
                                            <LuEllipsis className="w-3.5 h-3.5" />
                                        </span>
                                    </span>
                                </button>
                            </div>
                        );

                        if (folder.description) {
                            return (
                                <Tooltip key={folder.id} text={folder.description} position="top">
                                    {folderRow}
                                </Tooltip>
                            );
                        }
                        return folderRow;
                    })}
                    {folders.length === 0 && (
                        <p className="px-4 py-2 text-xs text-text-muted">No folders yet</p>
                    )}
                </nav>
            </div>

            {/* Bottom */}
            <div className="mt-auto px-3 py-3 border-t border-border flex items-center gap-1">
                <Button variant="icon" icon={MdOutlineBugReport} onClick={onOpenSupport} title="Report a Bug" />
                <ThemeToggle />
                <div className="flex-1" />
                {isAuthenticated ? (
                    <UserMenu onOpenUpgradeModal={onOpenUpgradeModal} />
                ) : (
                    <Button variant="ghost" size="sm" onClick={onOpenAuthModal}>
                        Sign In
                    </Button>
                )}
            </div>

            {/* Folder Context Menu */}
            {menuFolderId && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[9999] bg-surface-raised border border-border rounded-lg shadow-float py-1 px-1 min-w-[140px]"
                    style={{ top: menuPosition.top, left: menuPosition.left }}
                >
                    <button
                        type="button"
                        onClick={() => {
                            const folder = folders.find(f => f.id === menuFolderId);
                            if (folder) openEditModal(folder);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-text-main hover:bg-state-hover rounded-md flex items-center gap-2 cursor-pointer"
                    >
                        <LuPencil className="w-3.5 h-3.5" />
                        Edit
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onDeleteFolder(menuFolderId);
                            setMenuFolderId(null);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-state-hover rounded-md flex items-center gap-2 cursor-pointer"
                    >
                        <LuTrash className="w-3.5 h-3.5" />
                        Delete
                    </button>
                </div>,
                document.body
            )}

            {/* Create Folder Modal */}
            <Modal isOpen={showCreateModal} onClose={closeCreateModal} maxWidth="max-w-[400px]">
                <h2 className="text-lg font-semibold text-text-highlighted mb-4">New Folder</h2>
                <div className="flex flex-col gap-4">
                    <div>
                        <label htmlFor="folder-name" className="text-sm text-text-main block mb-1">Name</label>
                        <input
                            id="folder-name"
                            type="text"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && newFolderName.trim()) handleCreateFolder(); }}
                            placeholder="e.g. Product walkthroughs"
                            className={inputClassName}
                            autoFocus
                        />
                    </div>
                    <div>
                        <label htmlFor="folder-description" className="text-sm text-text-main block mb-1">
                            Description <span className="text-text-muted">(optional)</span>
                        </label>
                        <textarea
                            id="folder-description"
                            value={newFolderDescription}
                            onChange={e => setNewFolderDescription(e.target.value)}
                            placeholder="What's this folder for?"
                            rows={2}
                            className={`${inputClassName} resize-none`}
                        />
                    </div>
                    <div className="flex gap-3 justify-end">
                        <Button onClick={closeCreateModal}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                            Create
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Edit Folder Modal */}
            <Modal isOpen={!!editingFolder} onClose={closeEditModal} maxWidth="max-w-[400px]">
                <h2 className="text-lg font-semibold text-text-highlighted mb-4">Edit Folder</h2>
                <div className="flex flex-col gap-4">
                    <div>
                        <label htmlFor="edit-folder-name" className="text-sm text-text-main block mb-1">Name</label>
                        <input
                            id="edit-folder-name"
                            type="text"
                            value={editFolderName}
                            onChange={e => setEditFolderName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && editFolderName.trim()) handleEditFolder(); }}
                            className={inputClassName}
                            autoFocus
                        />
                    </div>
                    <div>
                        <label htmlFor="edit-folder-description" className="text-sm text-text-main block mb-1">
                            Description <span className="text-text-muted">(optional)</span>
                        </label>
                        <textarea
                            id="edit-folder-description"
                            value={editFolderDescription}
                            onChange={e => setEditFolderDescription(e.target.value)}
                            placeholder="What's this folder for?"
                            rows={2}
                            className={`${inputClassName} resize-none`}
                        />
                    </div>
                    <div className="flex gap-3 justify-end">
                        <Button onClick={closeEditModal}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={handleEditFolder} disabled={!editFolderName.trim()}>
                            Save
                        </Button>
                    </div>
                </div>
            </Modal>
        </aside>
    );
}
