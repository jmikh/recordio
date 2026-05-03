import { LuSearch } from 'react-icons/lu';
import { Dropdown } from '@shared/components/Dropdown';

export type FilterTab = 'all' | 'under_1min';
export type SortOrder = 'last_created' | 'last_updated' | 'longest' | 'shortest';

export const SORT_OPTIONS = [
    { value: 'last_created' as SortOrder, label: 'Last created' },
    { value: 'last_updated' as SortOrder, label: 'Last updated' },
    { value: 'longest' as SortOrder, label: 'Longest' },
    { value: 'shortest' as SortOrder, label: 'Shortest' },
];

interface FilterTabItem {
    value: FilterTab;
    label: string;
    count?: number;
}

interface DashboardHeaderProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    activeFilter: FilterTab;
    onFilterChange: (tab: FilterTab) => void;
    totalCount: number;
    under1MinCount: number;
    sortOrder: SortOrder;
    onSortChange: (sort: SortOrder) => void;
}

export function DashboardHeader({
    searchQuery,
    onSearchChange,
    activeFilter,
    onFilterChange,
    totalCount,
    under1MinCount,
    sortOrder,
    onSortChange,
}: DashboardHeaderProps) {
    const tabs: FilterTabItem[] = [
        { value: 'all', label: 'All', count: totalCount },
        { value: 'under_1min', label: 'Under 1 min', count: under1MinCount },
    ];


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
                        placeholder="Search recordings, folders, transcripts..."
                        className="w-full h-9 pl-9 pr-3 text-sm bg-surface-raised border border-border rounded-[var(--radius-interactive)] text-text-main placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
                    />
                </div>
            </div>

            {/* Filter tabs + sort */}
            <div className="flex items-center gap-1 border-b border-border">
                <div className="flex items-center gap-1 flex-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.value}
                            type="button"
                            onClick={() => onFilterChange(tab.value)}
                            className={`
                                relative px-3 py-2.5 text-sm transition-colors rounded-t-lg
                                ${activeFilter === tab.value
                                    ? 'text-text-highlighted font-medium'
                                    : 'text-text-muted hover:text-text-main'
                                }
                            `}
                        >
                            <span className="flex items-center gap-1.5">
                                {tab.label}
                                {tab.count !== undefined && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                        activeFilter === tab.value
                                            ? 'bg-primary/20 text-primary'
                                            : 'bg-surface-raised text-text-muted'
                                    }`}>
                                        {tab.count}
                                    </span>
                                )}
                            </span>
                            {activeFilter === tab.value && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                            )}
                        </button>
                    ))}
                </div>

                <div className="pb-1">
                    <Dropdown
                        options={SORT_OPTIONS}
                        value={sortOrder}
                        onChange={onSortChange}
                        fullWidth={false}
                        buttonClassName="h-8 text-xs"
                    />
                </div>
            </div>
        </div>
    );
}
