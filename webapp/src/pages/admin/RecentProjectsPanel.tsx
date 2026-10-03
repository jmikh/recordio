/**
 * /admin/projects — the most recently updated projects across every
 * account (plans/admin-user-impersonation-oneshot.md). Only mounts once
 * AdminPage's gate has confirmed the caller is an admin.
 *
 * One fetch (admin-project-list, ~100 rows, newest-updated first). Each
 * row shows the project, its owner, the recording length, and an icon
 * per feature the project carries (camera, mic, captions, zooms,
 * spotlights, blurs — primary-coloured when present, dimmed when absent). Clicking a row mints an
 * impersonation token for the OWNER and reboots the app straight into
 * that project's editor, so the admin sees exactly what the owner sees.
 */
import { useEffect, useState } from 'react';
import { LuCamera, LuCaptions, LuLightbulb, LuLoader, LuMic, LuZoomIn } from 'react-icons/lu';
import { TbBlur } from 'react-icons/tb';
import { Button, Tooltip } from '@shared/components';
import type { AdminProjectSummary } from '@shared/api';
import { invokeFunction } from '../../api/client';
import { startImpersonation } from '../../auth/impersonation';
import { editorPath } from '../../lib/videoUrls';
import { formatTimeCode } from '../../editor/utils';
import { timeAgo } from '../dashboard/timeAgo';

type Status = 'loading' | 'ready' | 'error';

type FeatureKey = 'has_camera' | 'has_mic' | 'has_captions' | 'has_zooms' | 'has_spotlights' | 'has_blurs';

/** Same glyphs the editor uses for each feature, so they read as the same thing. */
const FEATURES: Array<{ key: FeatureKey; label: string; icon: typeof LuCamera }> = [
    { key: 'has_camera', label: 'Camera', icon: LuCamera },
    { key: 'has_mic', label: 'Microphone', icon: LuMic },
    { key: 'has_captions', label: 'Captions', icon: LuCaptions },
    { key: 'has_zooms', label: 'Zooms', icon: LuZoomIn },
    { key: 'has_spotlights', label: 'Spotlights', icon: LuLightbulb },
    { key: 'has_blurs', label: 'Blurs', icon: TbBlur },
];

function FeatureIcons({ project }: { project: AdminProjectSummary }) {
    return (
        <div className="flex items-center gap-2 shrink-0">
            {FEATURES.map(({ key, label, icon: Icon }) => {
                const on = project[key];
                const text = on ? label : `No ${label.toLowerCase()}`;
                return (
                    <Tooltip key={key} text={text}>
                        <span role="img" aria-label={text} className="flex">
                            <Icon className={`icon-md ${on ? 'text-primary' : 'text-text-disabled'}`} />
                        </span>
                    </Tooltip>
                );
            })}
        </div>
    );
}

export function RecentProjectsPanel() {
    const [status, setStatus] = useState<Status>('loading');
    const [projects, setProjects] = useState<AdminProjectSummary[]>([]);
    const [openingId, setOpeningId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const { data, error } = await invokeFunction('admin-project-list', {});
            if (error || !data) {
                setStatus('error');
                return;
            }
            setProjects(data.projects);
            setStatus('ready');
        })();
    }, []);

    const open = async (project: AdminProjectSummary) => {
        if (openingId) return;
        setOpeningId(project.id);
        setErrorMsg(null);
        const { data, error } = await invokeFunction('admin-impersonate', { userId: project.owner_id });
        if (error || !data) {
            setOpeningId(null);
            setErrorMsg('Failed to start impersonation.');
            return;
        }
        // Boot as the owner directly inside this project's editor
        startImpersonation(data, editorPath(project.slug));
    };

    return (
        <div>
            <h1 className="heading-2 mb-1">Recent projects</h1>
            <p className="text-label mb-6">
                The latest projects across all accounts. Click one to open its editor as the
                owner — read-only, audit-logged.
            </p>

            {status === 'loading' && (
                <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
                    <LuLoader className="icon-md animate-spin" />
                    Loading projects...
                </div>
            )}

            {status === 'error' && (
                <p className="text-sm text-destructive" role="alert">Failed to load projects.</p>
            )}

            {status === 'ready' && (
                <>
                    {errorMsg && (
                        <p className="text-sm text-destructive mb-3" role="alert">{errorMsg}</p>
                    )}

                    {projects.length === 0 ? (
                        <p className="text-sm text-text-muted px-3 py-2">No projects yet.</p>
                    ) : (
                        <ul
                            aria-label="Recent projects"
                            className="border border-border rounded-md bg-surface divide-y divide-border max-h-[70vh] overflow-y-auto scrollbar-thin"
                        >
                            {projects.map(project => {
                                const owner = project.owner_email ?? project.owner_name ?? project.owner_id;
                                const opening = openingId === project.id;
                                return (
                                    <li
                                        key={project.id}
                                        onClick={() => open(project)}
                                        className={`flex items-center gap-4 px-3 py-2 cursor-pointer hover:bg-state-hover transition-colors ${opening ? 'bg-state-hover' : ''}`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-text-main truncate">{project.name}</div>
                                            <div className="text-xs text-text-muted truncate">{owner}</div>
                                        </div>
                                        <FeatureIcons project={project} />
                                        <span className="text-xs text-text-muted w-12 text-right shrink-0 tabular-nums">
                                            {project.duration_ms != null ? formatTimeCode(project.duration_ms) : '--:--'}
                                        </span>
                                        <span className="text-xs text-text-muted w-24 text-right shrink-0">
                                            {timeAgo(project.updated_at)}
                                        </span>
                                        <Button
                                            variant="base"
                                            aria-label={`Open ${project.name} as ${owner}`}
                                            disabled={openingId !== null}
                                            onClick={e => {
                                                e.stopPropagation();
                                                open(project);
                                            }}
                                        >
                                            {opening ? 'Opening...' : 'Open'}
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}
