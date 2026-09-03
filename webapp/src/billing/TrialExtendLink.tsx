import { useState } from 'react';
import { Button } from '@shared/components';
import type { WorkspaceEntitlements } from '@shared/api/entitlements';
import { invokeFunction } from '../api/client';
import { useToast } from '../components/Toast';
import { useUserStore } from '../auth/useUserStore';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useEntitlements } from './useEntitlements';
import { maybeOpenLeaveReviewModal } from '../components/LeaveReviewModal';
import { trackTrialExtended, trackTrialExtendFailed } from '../analytics';

interface TrialExtendLinkProps {
    /** Link text; the default suits standalone placements. */
    label?: string;
    className?: string;
    /** Runs right before the success modal opens — close the hosting surface here. */
    onExtended?: () => void;
}

/**
 * The "extend trial" hyperlink (billing revamp Step 3). Renders nothing
 * unless entitlements.canExtendTrial — drop it on any upgrade surface.
 * On click it grants the one self-serve extension (+7 days), applies
 * the returned entitlements to the store (gates unlock live), confirms
 * via toast, and follows with the review ask (LeaveReviewModal) unless
 * the user has already reviewed. Grant always precedes the ask.
 */
export function TrialExtendLink({
    label = 'Extend free trial — 7 more days',
    className,
    onExtended,
}: TrialExtendLinkProps) {
    const { canExtendTrial } = useEntitlements();
    const workspaceId = useWorkspaceStore(s => s.workspaceId);
    const [busy, setBusy] = useState(false);
    const { addToast } = useToast();

    if (!canExtendTrial || !workspaceId) return null;

    const applyEntitlements = (entitlements: WorkspaceEntitlements) => {
        const { subscription, setSubscription } = useWorkspaceStore.getState();
        setSubscription(subscription, entitlements, useUserStore.getState().userId ?? undefined);
    };

    const handleClick = async () => {
        if (busy) return;
        setBusy(true);
        const { data, error } = await invokeFunction('trial-extend', { workspaceId });
        setBusy(false);

        if (error || !data) {
            trackTrialExtendFailed(workspaceId);
            // The link was stale (extended elsewhere / workspace became
            // pro) — re-sync entitlements so it disappears.
            const sync = await invokeFunction('subscription-get', { workspaceId });
            if (sync.data) applyEntitlements(sync.data.entitlements);
            addToast({ type: 'error', title: 'Could not extend your trial' });
            return;
        }

        trackTrialExtended(workspaceId);
        applyEntitlements(data.entitlements);
        onExtended?.();
        addToast({
            type: 'success',
            title: 'Trial extended',
            message: "You've got Pro features for another week 🎉",
        });
        void maybeOpenLeaveReviewModal('trial_extended');
    };

    return (
        <Button
            variant="ghost"
            onClick={handleClick}
            disabled={busy}
            // interactive-ghost's h-9/px-3/text-sm win the cascade over plain
            // utilities here — force the inline-link shape
            className={`p-0! h-auto! text-xs! hover:underline ${className ?? ''}`}
        >
            {busy ? 'Extending…' : label}
        </Button>
    );
}
