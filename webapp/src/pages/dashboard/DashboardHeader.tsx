import { LuSearch } from 'react-icons/lu';
import { Button } from '@shared/components';
import { Dropdown } from '@shared/components/Dropdown';

/** Which kind of item the current library view lists */
export type ContentKind = 'videos' | 'screenshots';
export type SortOrder = 'last_created' | 'last_updated' | 'longest' | 'shortest';

const SORT_OPTIONS = [
    { value: 'last_created' as SortOrder, label: 'Last Created' },
    { value: 'last_updated' as SortOrder, label: 'Last Updated' },
    { value: 'longest' as SortOrder, label: 'Longest' },
    { value: 'shortest' as SortOrder, label: 'Shortest' },
];

/** Screenshots have no duration, so only the date sorts apply */
const SCREENSHOT_SORT_OPTIONS = SORT_OPTIONS.filter(o => o.value === 'last_created' || o.value === 'last_updated');

interface KindTab {
    value: ContentKind;
    label: string;
    count: number;
}

interface DashboardHeaderProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    activeKind: ContentKind;
    onKindChange: (kind: ContentKind) => void;
    videoCount: number;
    screenshotCount: number;
    sortOrder: SortOrder;
    onSortChange: (sort: SortOrder) => void;
    /** Trash is ordered by deletion time, so it hides the sort control */
    showSort?: boolean;
}

export function DashboardHeader({
    searchQuery,
    onSearchChange,
    activeKind,
    onKindChange,
    videoCount,
    screenshotCount,
    sortOrder,
    onSortChange,
    showSort = true,
}: DashboardHeaderProps) {
    const tabs: KindTab[] = [
        { value: 'videos', label: 'Videos', count: videoCount },
        { value: 'screenshots', label: 'Screenshots', count: screenshotCount },
    ];
    const sortOptions = activeKind === 'screenshots' ? SCREENSHOT_SORT_OPTIONS : SORT_OPTIONS;
    // A remembered duration sort has no screenshot equivalent — show the same fallback the grid sorts by
    const sortValue = sortOptions.some(o => o.value === sortOrder) ? sortOrder : 'last_created';

    return (
        <div className="px-6 pt-4">
            {/* Search row */}
            <div className="flex items-center justify-between mb-4">
                <div className="relative w-72">
                    <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 icon-sm text-text-muted pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => onSearchChange(e.target.value)}
                        aria-label="Search library"
                        placeholder={activeKind === 'videos' ? 'Search recordings, transcripts...' : 'Search screenshots...'}
                        className="w-full h-9 pl-9 pr-3 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
                    />
                </div>
            </div>

            {/* Kind tabs + sort */}
            <div className="flex items-center gap-1 border-b border-border">
                <div className="flex items-center gap-1 flex-1" role="tablist" aria-label="Library content">
                    {tabs.map(tab => {
                        const isActive = activeKind === tab.value;
                        return (
                            <Button
                                key={tab.value}
                                variant="ghost"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => onKindChange(tab.value)}
                                className={`relative px-3 py-2.5 rounded-t-lg rounded-b-none ${isActive ? 'text-text-highlighted' : 'text-text-muted'}`}
                            >
                                {tab.label}
                                <span className={`text-badge px-1.5 py-1 rounded-full ${
                                    isActive ? 'bg-primary/20 text-primary' : 'bg-state-inactive text-text-muted'
                                }`}>
                                    {tab.count}
                                </span>
                                {isActive && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                                )}
                            </Button>
                        );
                    })}
                </div>

                {showSort && (
                    <div className="pb-1">
                        <Dropdown
                            options={sortOptions}
                            value={sortValue}
                            onChange={onSortChange}
                            fullWidth={false}
                            buttonClassName="h-8"
                            ariaLabel="Sort by"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
