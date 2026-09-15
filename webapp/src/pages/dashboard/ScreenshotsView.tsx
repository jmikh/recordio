/**
 * Dashboard "Screenshots" section (plans/screenshots Step 11): a grid of
 * ProjectCards for the workspace's screenshots the caller can see.
 */
import { LuImage } from 'react-icons/lu';
import { CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { ProjectCard } from './ProjectCard';
import { screenshotUrl } from '../../lib/screenshotUrls';
import type { ScreenshotListItem } from '../../screenshot/screenshotService';

interface ScreenshotsViewProps {
    items: ScreenshotListItem[];
    loading: boolean;
    userId: string | null;
    onOpen: (item: ScreenshotListItem) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    onShare: (item: ScreenshotListItem) => void;
}

export function ScreenshotsView({ items, loading, userId, onOpen, onRename, onDelete, onShare }: ScreenshotsViewProps) {
    return (
        <main className="flex-1 overflow-y-auto p-6">
            <div className="mb-6 flex items-baseline gap-2">
                <h1 className="heading-2">Screenshots</h1>
                <span className="text-label">{items.length}</span>
            </div>
            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <div className="text-text-muted">Loading screenshots...</div>
                </div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <LuImage size={40} className="text-text-muted/50" />
                    <p className="text-sm text-text-muted text-center">
                        Switch the{' '}
                        <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-highlighted underline">
                            Recordio extension
                        </a>{' '}
                        to Image mode to capture your first screenshot.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                    {items.map(item => (
                        <ProjectCard
                            key={item.id}
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
                        />
                    ))}
                </div>
            )}
        </main>
    );
}
