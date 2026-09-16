import type { SharePolicy } from '@shared/api';
import type { Toast } from '../components/Toast';

/**
 * Toast content for a "link copied" confirmation. A workspace link only opens
 * for members, so the copy says so and points at public sharing — the same
 * wording everywhere a share link is copied (cards, share dialogs).
 */
export function copiedLinkToast(sharePolicy?: SharePolicy | null): Omit<Toast, 'id'> {
    return {
        type: 'success',
        title: 'Link copied to clipboard',
        message: sharePolicy === 'workspace'
            ? 'Only workspace members can open this link — share publicly to let anyone with the link view it.'
            : undefined,
    };
}
