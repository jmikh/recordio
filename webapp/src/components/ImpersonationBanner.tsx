/**
 * Persistent banner shown on every page while impersonating a user
 * (plans/admin-user-impersonation-oneshot.md) — the guardrail for
 * full read-write impersonation. State only changes via full reloads
 * (start/stopImpersonation), so reading it once per mount is enough.
 */
import { Button } from '@shared/components';
import { getImpersonation, stopImpersonation } from '../auth/impersonation';

export function ImpersonationBanner() {
    const impersonation = getImpersonation();
    if (!impersonation) return null;

    const target = impersonation.target;
    const who = target.email || target.name || target.id;
    return (
        <div
            role="alert"
            className="fixed bottom-0 inset-x-0 z-[9999] flex items-center justify-center gap-4 bg-surface-raised border-t border-destructive/30 shadow-float px-4 py-2"
        >
            <span className="text-sm text-destructive">
                Viewing as <span className="font-bold">{who}</span> — full access, changes are real.
            </span>
            <Button variant="base" onClick={stopImpersonation}>
                Exit
            </Button>
        </div>
    );
}
