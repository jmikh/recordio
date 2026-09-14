import { useState } from 'react';
import { LuBookmarkPlus } from 'react-icons/lu';
import { Button, Modal, Tooltip } from '@shared/components';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUserStore } from '../../../auth/useUserStore';
import { useToast } from '../../../components/Toast';
import { UserDefaultsService } from '../../../storage/userDefaultsService';
import { captureError } from '../../../lib/sentry';
import { trackPersonalDefaultsSaved } from '../../../analytics';

/**
 * "Use as my default settings" — promotes the open project's settings to
 * the user's personal defaults for NEW projects
 * (plans/user-default-project-settings §3.9). Recording-specific fields
 * (crop, face anchor, transcription source) are stripped by
 * UserDefaultsService.save; existing projects are untouched. Hidden when
 * signed out — defaults live on the user's profile.
 */
export function SetAsDefaultsButton() {
    const isAuthenticated = useUserStore(s => s.isAuthenticated);
    const { addToast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    if (!isAuthenticated) return null;

    const handleConfirm = async () => {
        setSaving(true);
        const { project } = useProjectStore.getState();
        try {
            await UserDefaultsService.save(project.settings);
            trackPersonalDefaultsSaved({ source: 'editor' });
            addToast({
                type: 'success',
                title: 'Defaults updated',
                message: 'New projects will start with this look.',
                action: { label: 'View', href: '/settings/personal' },
            });
            setIsOpen(false);
        } catch (err) {
            captureError(err, { flow: 'user_defaults', phase: 'save_from_editor', projectId: project.id });
            addToast({ type: 'error', title: 'Could not save defaults', message: 'Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Tooltip text="Use as my default settings">
                <Button
                    variant="ghost"
                    icon={LuBookmarkPlus}
                    aria-label="Use as my default settings"
                    onClick={() => setIsOpen(true)}
                />
            </Tooltip>

            <Modal
                isOpen={isOpen}
                onClose={() => { if (!saving) setIsOpen(false); }}
                maxWidth="max-w-[460px]"
                ariaLabel="Use as default settings"
            >
                <h2 className="heading-2 mb-2">Use as default settings?</h2>
                <p className="text-sm text-text-main mb-2">
                    New projects will start with this project’s look — background, screen,
                    camera, effects, captions style, audio and motion settings.
                </p>
                <p className="text-label mb-6">
                    This replaces your current personal defaults. Recording-specific items
                    (crop, face anchor, caption text) aren’t included, and existing projects
                    don’t change.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="base" onClick={() => setIsOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleConfirm} disabled={saving}>
                        {saving ? 'Saving…' : 'Set as defaults'}
                    </Button>
                </div>
            </Modal>
        </>
    );
}
