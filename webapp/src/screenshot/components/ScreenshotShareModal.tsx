/**
 * Share settings for a screenshot (policy-only sharing, plans/screenshots
 * Step 10): visibility + workspace access via the shared
 * SharePolicyControls, copy link, and — in the editor, where the source
 * image is at hand — publishing the flattened render the public page
 * serves. The dashboard opens it without `image`; policy changes still
 * apply and the note explains that the render comes from the editor.
 */
import { LuLink } from 'react-icons/lu';
import { Button, Modal } from '@shared/components';
import type { AccessRole, SharePolicy } from '@shared/api';
import { useUserStore } from '../../auth/useUserStore';
import { useToast } from '../../components/Toast';
import { captureError } from '../../lib/sentry';
import { screenshotUrl } from '../../lib/screenshotUrls';
import { trackScreenshotShared } from '../../analytics';
import { OwnerOnlyNote, ShareCreatorRow, SharePolicyControls } from '../../share/SharePolicyControls';
import { ScreenshotService } from '../screenshotService';
import { useScreenshotMetaStore } from '../store/useScreenshotMetaStore';
import { useScreenshotStore } from '../store/useScreenshotStore';
import { publishRenderIfNeeded } from '../publish';

interface ScreenshotShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Decoded source — present in the editor; absent on the dashboard */
    image?: HTMLImageElement | null;
}

export function ScreenshotShareModal({ isOpen, onClose, image }: ScreenshotShareModalProps) {
    const meta = useScreenshotMetaStore(s => s.meta);
    const setShareSettings = useScreenshotMetaStore(s => s.setShareSettings);
    const userId = useUserStore(s => s.userId);
    const { addToast } = useToast();

    if (!meta) return null;
    const isOwner = meta.ownerId === userId;
    const isShared = meta.sharePolicy !== 'private';
    const cloudVersion = ScreenshotService.getCloudVersion(meta.id) ?? meta.cloudVersion;
    const published = meta.renderCloudVersion !== null;
    const stale = published && meta.renderCloudVersion !== cloudVersion;

    const publish = async () => {
        const doc = useScreenshotStore.getState().doc;
        if (!image || !doc || doc.id !== meta.id) return;
        await publishRenderIfNeeded(image, doc);
    };

    const applyShareSettings = async (sharePolicy: SharePolicy, workspaceAccess: AccessRole) => {
        if (sharePolicy === meta.sharePolicy && workspaceAccess === meta.workspaceAccess) return;
        const previous = { sharePolicy: meta.sharePolicy, workspaceAccess: meta.workspaceAccess };
        setShareSettings(sharePolicy, workspaceAccess);
        try {
            await ScreenshotService.shareScreenshot(meta.id, sharePolicy, workspaceAccess);
            trackScreenshotShared({ screenshot_id: meta.id, share_policy: sharePolicy, workspace_access: workspaceAccess });
        } catch (err) {
            setShareSettings(previous.sharePolicy, previous.workspaceAccess);
            captureError(err, { flow: 'screenshot_share', extra: { screenshotId: meta.id } });
            addToast({ type: 'error', title: 'Failed to update share settings' });
            return;
        }
        if (sharePolicy !== 'private') void publish();
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(screenshotUrl(meta.slug));
            addToast({ type: 'success', title: 'Link copied to clipboard' });
        } catch {
            addToast({ type: 'error', title: 'Failed to copy link' });
            return;
        }
        // Copying the link is the "I'm sharing this now" moment — make
        // sure the published image matches the latest edits
        void publish();
    };

    const publishNote = !isShared
        ? null
        : !published
            ? (image ? 'Publishing the image…' : 'Open the screenshot in the editor to publish the image.')
            : stale
                ? (image ? 'Updating the published image…' : 'The published image is behind your latest edits — open the editor to update it.')
                : null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[480px]" ariaLabel="Share screenshot">
            <div className="flex flex-col gap-4">
                <h2 className="heading-2 truncate">Share &ldquo;{meta.name}&rdquo;</h2>

                <div className="flex flex-col gap-1">
                    <span className="text-sm text-text-highlighted">Who has access</span>
                    <SharePolicyControls
                        sharePolicy={meta.sharePolicy}
                        workspaceAccess={meta.workspaceAccess}
                        isOwner={isOwner}
                        onChange={(p, a) => void applyShareSettings(p, a)}
                    />
                    <ShareCreatorRow name={meta.ownerName} email={meta.ownerEmail} isViewer={isOwner} />
                    {!isOwner && <OwnerOnlyNote />}
                    {publishNote && <p role="status" className="text-label">{publishNote}</p>}
                </div>

                <Button variant="primary" fullWidth icon={LuLink} onClick={() => void handleCopyLink()}>
                    Copy link
                </Button>
            </div>
        </Modal>
    );
}
