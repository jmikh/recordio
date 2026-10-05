/**
 * Persistent banner shown on every non-editor page while impersonating a
 * user (plans/admin-user-impersonation-oneshot.md). Impersonation is
 * read-only — the API refuses every write on the token (see
 * shared/api/impersonation.ts) — and this banner is what says so.
 *
 * The editors don't get it: a bottom bar covers the timeline, so they
 * show ImpersonationHeaderButton in their header instead (App decides).
 */
import { LuCopy } from 'react-icons/lu';
import { Button } from '@shared/components';
import { useImpersonationControls } from './useImpersonationControls';

export function ImpersonationBanner() {
    const { who, canClone, cloning, clone, exit } = useImpersonationControls();

    if (!who) return null;

    return (
        <div
            role="alert"
            className="fixed bottom-0 inset-x-0 z-[9999] flex items-center justify-center gap-4 bg-surface-raised border-t border-destructive/30 shadow-float px-4 py-2"
        >
            <span className="text-sm text-destructive">
                Viewing as <span className="font-bold">{who}</span> — read-only, nothing you do is saved.
            </span>
            {canClone && (
                <Button variant="base" icon={LuCopy} disabled={cloning} onClick={clone}>
                    {cloning ? 'Cloning…' : 'Clone'}
                </Button>
            )}
            <Button variant="base" onClick={exit}>
                Exit
            </Button>
        </div>
    );
}
