/**
 * Dashboard screenshot grid (plans/screenshots Step 11): the ProjectCards for
 * the live screenshots in the current library view (Yours / Workspace).
 * The surrounding header (search, Videos/Screenshots tabs, sort) lives in
 * DashboardPage so it is shared with the video grid.
 */
import { LuImage } from 'react-icons/lu';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { ProjectCard } from './ProjectCard';
import { screenshotUrl } from '../../lib/screenshotUrls';
import type { ScreenshotListItem } from '../../screenshot/screenshotService';

interface ScreenshotCardProps {
    item: ScreenshotListItem;
    userId: string | null;
    showUpdatedAt: boolean;
    onOpen: (item: ScreenshotListItem) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onShare: (item: ScreenshotListItem) => void;
}

/**
 * One live screenshot card. Exported so the mixed "All" grid on the dashboard
 * can interleave these with video cards without duplicating the card wiring.
 */
export function ScreenshotCard({ item, userId, showUpdatedAt, onOpen, onRename, onDelete, onShare }: ScreenshotCardProps) {
    return (
        <ProjectCard
            variant="grid"
            project={{
                id: item.id,
                name: item.name,
                thumbnail: item.thumbnail,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                shareSlug: item.slug,
                sharePolicy: item.sharePolicy,
            }}
            shareUrl={screenshotUrl(item.slug)}
            badge={<LuImage className="icon-sm" aria-label="Screenshot" />}
            onOpen={() => onOpen(item)}
            onRename={item.ownerId === userId ? onRename : undefined}
            onDelete={item.ownerId === userId ? onDelete : undefined}
            onShare={item.ownerId === userId ? () => onShare(item) : undefined}
            showUpdatedAt={showUpdatedAt}
        />
    );
}

/** One trashed screenshot card — restore only, no menu actions */
export function TrashScreenshotCard({ item, onRestore }: { item: ScreenshotListItem; onRestore: (id: string) => void }) {
    return (
        <ProjectCard
            variant="grid"
            project={{
                id: item.id,
                name: item.name,
                thumbnail: item.thumbnail,
                createdAt: item.createdAt,
                deletedAt: item.deletedAt,
            }}
            shareUrl={screenshotUrl(item.slug)}
            badge={<LuImage className="icon-sm" aria-label="Screenshot" />}
            onOpen={() => {}}
            onRestore={() => onRestore(item.id)}
        />
    );
}

interface ScreenshotsViewProps {
    items: ScreenshotListItem[];
    loading: boolean;
    /** True when a search query is active — the empty state says so instead of onboarding */
    filtered: boolean;
    userId: string | null;
    showUpdatedAt: boolean;
    onOpen: (item: ScreenshotListItem) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onShare: (item: ScreenshotListItem) => void;
}

export function ScreenshotsView({ items, loading, filtered, userId, showUpdatedAt, onOpen, onRename, onDelete, onShare }: ScreenshotsViewProps) {
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-text-muted">Loading screenshots...</div>
            </div>
        );
    }
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
                <LuImage size={40} className="text-text-muted/50" />
                <p className="text-sm text-text-muted text-center">
                    {filtered ? 'No screenshots match your search.' : (
                        <>
                            Switch the{' '}
                            <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">
                                Recordio extension
                            </a>{' '}
                            to Image mode to capture your first screenshot.
                        </>
                    )}
                </p>
            </div>
        );
    }
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
            {items.map(item => (
                <ScreenshotCard
                    key={item.id}
                    item={item}
                    userId={userId}
                    showUpdatedAt={showUpdatedAt}
                    onOpen={onOpen}
                    onRename={onRename}
                    onDelete={onDelete}
                    onShare={onShare}
                />
            ))}
        </div>
    );
}
