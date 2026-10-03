/**
 * /admin/subscribers — every workspace that has (or had) a Stripe
 * subscription (plans/admin-user-impersonation-oneshot.md). Only mounts
 * once AdminPage's gate has confirmed the caller is an admin.
 *
 * One fetch (admin-subscriber-list), newest subscriber first. Each row:
 * who, their plan (there is one per-seat plan, so interval + seats),
 * Stripe's status as a badge — a scheduled cancellation is called out
 * with its date — when they first subscribed, and when the account was
 * created. The header tallies live vs. canceled.
 */
import { useEffect, useMemo, useState } from 'react';
import { LuLoader } from 'react-icons/lu';
import { StatusBadge, type StatusBadgeVariant } from '@shared/components';
import type { AdminSubscriberSummary } from '@shared/api';
import { invokeFunction } from '../../api/client';

type Status = 'loading' | 'ready' | 'error';

/** Mirrors the server's PRO_STATUSES (services/entitlements.ts): what still counts as paying. */
const LIVE_STATUSES = new Set(['active', 'past_due', 'trialing']);

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function planLabel(s: AdminSubscriberSummary): string {
    const interval = s.billing_interval === 'yearly' ? 'Yearly' : s.billing_interval === 'monthly' ? 'Monthly' : 'Pro';
    return `${interval} · ${s.seats} ${s.seats === 1 ? 'seat' : 'seats'}`;
}

/** Badge text + tone for a row's state. Scheduled cancellation outranks the live status. */
function statusBadge(s: AdminSubscriberSummary): { label: string; variant: StatusBadgeVariant } {
    if (s.status === 'canceled') return { label: 'Canceled', variant: 'default' };
    if (s.cancel_at && LIVE_STATUSES.has(s.status)) {
        return { label: `Cancels ${formatDate(s.cancel_at)}`, variant: 'secondary' };
    }
    if (s.status === 'active') return { label: 'Active', variant: 'primary' };
    if (s.status === 'trialing') return { label: 'Trialing', variant: 'primary' };
    if (s.status === 'past_due') return { label: 'Past due', variant: 'secondary' };
    return { label: s.status, variant: 'default' };
}

export function SubscribersPanel() {
    const [status, setStatus] = useState<Status>('loading');
    const [subscribers, setSubscribers] = useState<AdminSubscriberSummary[]>([]);

    useEffect(() => {
        (async () => {
            const { data, error } = await invokeFunction('admin-subscriber-list', {});
            if (error || !data) {
                setStatus('error');
                return;
            }
            setSubscribers(data.subscribers);
            setStatus('ready');
        })();
    }, []);

    const tally = useMemo(() => {
        const live = subscribers.filter(s => LIVE_STATUSES.has(s.status));
        return {
            live: live.length,
            cancelling: live.filter(s => s.cancel_at).length,
            canceled: subscribers.filter(s => s.status === 'canceled').length,
            seats: live.reduce((sum, s) => sum + s.seats, 0),
        };
    }, [subscribers]);

    return (
        <div>
            <h1 className="heading-2 mb-1">Subscribers</h1>
            <p className="text-label mb-6">
                Every workspace that has checked out, newest first. Status is Stripe&apos;s; a
                scheduled cancellation shows its end date.
            </p>

            {status === 'loading' && (
                <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
                    <LuLoader className="icon-md animate-spin" />
                    Loading subscribers...
                </div>
            )}

            {status === 'error' && (
                <p className="text-sm text-destructive" role="alert">Failed to load subscribers.</p>
            )}

            {status === 'ready' && (
                <>
                    <div className="flex flex-wrap gap-6 mb-4 text-sm text-text-main">
                        <span><span className="font-bold">{tally.live}</span> live</span>
                        <span><span className="font-bold">{tally.seats}</span> paid seats</span>
                        <span><span className="font-bold">{tally.cancelling}</span> cancelling</span>
                        <span><span className="font-bold">{tally.canceled}</span> canceled</span>
                    </div>

                    {subscribers.length === 0 ? (
                        <p className="text-sm text-text-muted px-3 py-2">No subscribers yet.</p>
                    ) : (
                        <div className="border border-border rounded-md bg-surface max-h-[70vh] overflow-y-auto scrollbar-thin">
                            <table className="w-full text-sm" aria-label="Subscribers">
                                <thead className="sticky top-0 bg-surface">
                                    <tr className="text-left text-eyebrow">
                                        <th className="px-3 py-2">Subscriber</th>
                                        <th className="px-3 py-2">Plan</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2">Subscribed</th>
                                        <th className="px-3 py-2">Account created</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {subscribers.map(s => {
                                        const badge = statusBadge(s);
                                        return (
                                            <tr key={s.workspace_id} className="hover:bg-state-hover transition-colors">
                                                <td className="px-3 py-2 min-w-0">
                                                    <div className="text-text-main truncate">{s.email ?? s.user_id}</div>
                                                    <div className="text-xs text-text-muted truncate">
                                                        {[s.name, s.workspace_name].filter(Boolean).join(' · ')}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap text-text-main">{planLabel(s)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap text-text-muted">{formatDate(s.subscribed_at)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap text-text-muted">{formatDate(s.account_created_at)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
