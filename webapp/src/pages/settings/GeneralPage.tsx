import { useState, useEffect } from 'react';
import { Button } from '@shared/components';
import { invokeFunction } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { trackGeneralSettingsPageLoaded } from '../../analytics';
import { captureError } from '../../lib/sentry';
import type { WorkspaceDetails } from './types';

export function GeneralPage({ details, isAdmin, onRenamed }: {
    details: WorkspaceDetails;
    isAdmin: boolean;
    onRenamed: (name: string) => void;
}) {
    const [name, setName]     = useState(details.name);
    const [saving, setSaving] = useState(false);
    const { addToast }        = useToast();
    useEffect(() => { trackGeneralSettingsPageLoaded(useWorkspaceStore.getState().workspaceId); }, []);

    const handleSave = async () => {
        const trimmed = name.trim();
        if (!trimmed || trimmed === details.name) return;
        setSaving(true);
        try {
            const { data, error } = await invokeFunction('workspace-rename', {
                workspaceId: details.id,
                name: trimmed,
            });
            if (error) throw error;
            onRenamed(data.name);
            addToast({ type: 'success', title: `Workspace renamed to "${data.name}"` });
        } catch (err) {
            captureError(err, { flow: 'workspace', phase: 'rename', workspaceId: details.id });
            addToast({ type: 'error', title: 'Failed to rename workspace' });
        } finally {
            setSaving(false);
        }
    };

    const inputClass = "w-full px-3 py-2 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    return (
        <div className="w-full max-w-lg">
            <h2 className="text-base font-semibold text-text-highlighted mb-6">General</h2>
            <div className="flex flex-col gap-1.5">
                <label className="text-sm text-text-main">Workspace Name</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                        className={inputClass}
                        disabled={!isAdmin}
                        maxLength={60}
                    />
                    {isAdmin && (
                        <Button
                            variant="primary"
                            onClick={handleSave}
                            disabled={saving || !name.trim() || name.trim() === details.name}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
