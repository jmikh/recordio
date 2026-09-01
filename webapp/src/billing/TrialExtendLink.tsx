import { useState } from 'react';
import { Button } from '@shared/components';
import type { WorkspaceEntitlements } from '@shared/api/entitlements';
import { invokeFunction } from '../api/client';
import { useToast } from '../components/Toast';
import { useUserStore } from '../auth/useUserStore';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useEntitlements } from './useEntitlements';
import { useTrialExtendedModal } from './TrialExtendedModal';
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
 * the returned entitlements to the store (gates unlock live), and opens
 * the global TrialExtendedModal with the review ask.
 */
export function TrialExtendLink({
    label = 'Extend free trial — 7 more days',
    className,
    onExtended,
}: TrialExtendLinkProps) {
    const { canExtendTrial } = useEntitlements();
    const workspaceId = useWorkspaceStore(s => s.workspaceId);
    const openExtendedModal = useTrialExtendedModal(s => s.open);
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
        openExtendedModal();
    };

    return (
        <Button
            variant="ghost"
            onClick={handleClick}
            disabled={busy}
            className={`p-0 text-xs text-primary font-medium hover:underline ${className ?? ''}`}
        >
            {busy ? 'Extending…' : label}
        </Button>
    );
}
