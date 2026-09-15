/**
 * Header Share button: opens ScreenshotShareModal, or the Pro upgrade
 * modal when the workspace can't share (same gate as the video editor).
 */
import { useState } from 'react';
import { LuShare2 } from 'react-icons/lu';
import { Button } from '@shared/components';
import { useEntitlements } from '../../billing/useEntitlements';
import { ProUpgradeModal } from '../../billing/ProUpgradeModal';
import { useScreenshotMetaStore } from '../store/useScreenshotMetaStore';
import { ScreenshotShareModal } from './ScreenshotShareModal';

export function ScreenshotShareButton({ image }: { image: HTMLImageElement | null }) {
    const entitlements = useEntitlements();
    const shareReady = useScreenshotMetaStore(s => s.meta !== null);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [isProOpen, setIsProOpen] = useState(false);

    return (
        <>
            <Button
                variant="primary"
                icon={LuShare2}
                disabled={entitlements.canShare && !shareReady}
                onClick={() => (entitlements.canShare ? setIsShareOpen(true) : setIsProOpen(true))}
            >
                Share
            </Button>
            <ScreenshotShareModal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} image={image} />
            <ProUpgradeModal isOpen={isProOpen} onClose={() => setIsProOpen(false)} feature="sharing" reason="share" />
        </>
    );
}
