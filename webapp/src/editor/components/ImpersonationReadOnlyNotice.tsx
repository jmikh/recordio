/**
 * Tells the admin, once per editor session, that their edits are going
 * nowhere (plans/admin-user-impersonation-oneshot.md).
 *
 * Impersonation is read-only, so the 2s auto-save is dropped before it
 * reaches the API (CloudProjectService.saveProject). That silence is the
 * point — a 403 toast every two seconds would be worse — but silence
 * alone lets you edit for ten minutes believing it stuck. The bottom
 * banner says "read-only"; this says it at the moment it starts to
 * matter, which is the first edit.
 *
 * Null-rendering subscriber, like ActivityToasts: the auto-save signal
 * lives in a store, the toast needs React context.
 */
import { useEffect } from 'react';
import { useToast } from '../../components/Toast';
import { useProjectStore } from '../stores/useProjectStore';
import { getImpersonation } from '../../auth/impersonation';

export function ImpersonationReadOnlyNotice() {
    const { addToast } = useToast();

    useEffect(() => {
        if (!getImpersonation()) return;
        let announced = false;
        return useProjectStore.subscribe(
            (state) => state.project,
            (project, previous) => {
                // A different id is the project LOADING, not an edit —
                // the initial set() carries the generated auto-effects too
                if (announced || !previous.id || previous.id !== project.id) return;
                announced = true;
                addToast({
                    type: 'info',
                    title: 'Read-only — this edit is not saved',
                    message: 'You are viewing another user\'s account. Use Clone to get an editable copy in your own workspace.',
                    duration: 0,
                });
            },
        );
    }, [addToast]);

    return null;
}
