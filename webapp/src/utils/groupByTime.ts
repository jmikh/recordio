export interface TimeGroup<T> {
    label: string;
    count: string;
    items: T[];
}

/**
 * Groups items by time period based on a date field.
 * Returns only non-empty groups, ordered from most recent to oldest.
 */
export function groupByTime<T>(
    items: T[],
    getDate: (item: T) => string | Date,
): TimeGroup<T>[] {
    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = startOfDay(addDays(now, -1));
    const weekStart = startOfWeek(now);
    const lastWeekStart = startOfWeek(addDays(now, -7));
    const monthStart = startOfMonth(now);

    const buckets: { label: string; items: T[] }[] = [
        { label: 'Today', items: [] },
        { label: 'Yesterday', items: [] },
        { label: 'Earlier this week', items: [] },
        { label: 'Last week', items: [] },
        { label: 'This month', items: [] },
        { label: 'Older', items: [] },
    ];

    for (const item of items) {
        const d = new Date(getDate(item));
        if (d >= todayStart) {
            buckets[0].items.push(item);
        } else if (d >= yesterdayStart) {
            buckets[1].items.push(item);
        } else if (d >= weekStart) {
            buckets[2].items.push(item);
        } else if (d >= lastWeekStart) {
            buckets[3].items.push(item);
        } else if (d >= monthStart) {
            buckets[4].items.push(item);
        } else {
            buckets[5].items.push(item);
        }
    }

    return buckets
        .filter(b => b.items.length > 0)
        .map(b => ({
            label: b.label,
            count: `${b.items.length} recording${b.items.length !== 1 ? 's' : ''}`,
            items: b.items,
        }));
}

function startOfDay(d: Date): Date {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
}

function startOfWeek(d: Date): Date {
    const r = new Date(d);
    const day = r.getDay();
    // Week starts on Monday
    const diff = day === 0 ? 6 : day - 1;
    r.setDate(r.getDate() - diff);
    r.setHours(0, 0, 0, 0);
    return r;
}

function startOfMonth(d: Date): Date {
    const r = new Date(d);
    r.setDate(1);
    r.setHours(0, 0, 0, 0);
    return r;
}

function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}
