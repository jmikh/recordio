/**
 * Shared state + actions behind the two impersonation surfaces
 * (plans/admin-user-impersonation-oneshot.md): the bottom banner on
 * regular pages and the header popover in the editors, where a bottom
 * bar would cover the timeline.
 *
 * Impersonation state only changes via full reloads
 * (start/stopImpersonation), so reading it once per mount is enough;
 * the current path is not, hence the navigation subscription for Clone.
 *
 * Clone (/project-clone) copies the project the admin is currently
 * looking at — media and all — into the admin's OWN default workspace,
 * so it survives leaving the impersonation session. It's only offered on
 * a project URL, since that's the only place there's something to clone.
 */
import { useEffect, useState } from 'react';
import type { ProjectCloneRequest } from '@shared/api';
import { getImpersonation, stopImpersonation } from '../auth/impersonation';
import { apiErrorMessage, invokeFunction } from '../api/client';
import { useToast } from './Toast';
import { editorPath } from '../lib/videoUrls';

/** /video/{slug}[/edit] and the legacy /editor?projectId= form */
const VIDEO_PATH = /^\/video\/([^/]+)(?:\/edit)?\/?$/;

/** What the URL says we're looking at — null when it isn't a project. */
function currentProjectRef(): ProjectCloneRequest | null {
    const slug = VIDEO_PATH.exec(window.location.pathname)?.[1];
    if (slug) return { slug };
    if (window.location.pathname.startsWith('/editor')) {
        const projectId = new URLSearchParams(window.location.search).get('projectId');
        if (projectId) return { projectId };
    }
    return null;
}

export function useImpersonationControls() {
    const impersonation = getImpersonation();
    const { addToast } = useToast();
    const [projectRef, setProjectRef] = useState(currentProjectRef);
    const [cloning, setCloning] = useState(false);

    useEffect(() => {
        const onNavigate = () => setProjectRef(currentProjectRef());
        window.addEventListener('popstate', onNavigate);
        window.addEventListener('navigate', onNavigate);
        return () => {
            window.removeEventListener('popstate', onNavigate);
            window.removeEventListener('navigate', onNavigate);
        };
    }, []);

    const target = impersonation?.target;
    const who = target ? target.email || target.name || target.id : null;

    const clone = async () => {
        if (!projectRef) return;
        setCloning(true);
        const { data, error } = await invokeFunction('project-clone', projectRef);
        setCloning(false);
        if (error || !data) {
            addToast({
                type: 'error',
                title: 'Clone failed',
                message: await apiErrorMessage(error, 'Could not clone this project'),
            });
            return;
        }
        addToast({
            type: 'success',
            title: 'Cloned to your workspace',
            message: data.name,
            // Persistent: the clone lives in the admin's own account, so
            // opening it means leaving the impersonation session
            duration: 0,
            action: { label: 'Open', onClick: () => stopImpersonation(editorPath(data.slug)) },
        });
    };

    return {
        /** Null when not impersonating — callers render nothing */
        who,
        canClone: projectRef !== null,
        cloning,
        clone,
        exit: () => stopImpersonation(),
    };
}
