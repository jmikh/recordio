/**
 * Loading placeholder for the dashboard grids: silhouettes shaped like the
 * grid-variant ProjectCard (16:9 thumbnail, title row, metadata row) so the
 * layout doesn't jump when the real cards arrive.
 */

const SKELETON_COUNT = 8;

function ProjectCardSkeleton() {
    return (
        <div aria-hidden="true" className="flex flex-col bg-surface rounded-xl border border-border overflow-hidden animate-pulse">
            <div className="w-full aspect-video bg-state-hover border-b border-border" />
            <div className="p-3">
                {/* min-h-9 matches the real card's title row */}
                <div className="flex items-center min-h-9">
                    <div className="h-3.5 w-2/3 rounded bg-state-hover" />
                </div>
                <div className="h-3 w-1/3 rounded bg-state-hover my-[3px]" />
            </div>
        </div>
    );
}

/** Grid of card silhouettes; `label` stays in the DOM for screen readers and e2e waits */
export function ProjectGridSkeleton({ label }: { label: string }) {
    return (
        <div role="status" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
            <span className="sr-only">{label}</span>
            {Array.from({ length: SKELETON_COUNT }, (_, i) => <ProjectCardSkeleton key={i} />)}
        </div>
    );
}
