import { useEffect, useRef, type RefObject } from 'react';
import { useProjectStore } from '../stores/useProjectStore';
import { useMediaUrlStore } from '../../storage/useMediaUrlStore';
import { captureError } from '../../lib/sentry';
import { getActiveCameraMatte } from '@shared/utils/cameraMatte';
import { MaskPlayer } from './MaskPlayer';

/**
 * Loads the camera's person mask for playback while background removal is
 * active. Returns a ref for the render loop; it's null until the mask is
 * ready (the camera draws with its background until then).
 */
export function useCameraMaskPlayer(): RefObject<MaskPlayer | null> {
    const mattePath = useProjectStore(s => getActiveCameraMatte(s.project)?.storagePath);
    const url = useMediaUrlStore(s => (mattePath ? s.urls[mattePath] : undefined));
    const playerRef = useRef<MaskPlayer | null>(null);

    useEffect(() => {
        if (!mattePath || !url) return;
        let disposed = false;
        let player: MaskPlayer | null = null;
        MaskPlayer.load(url, mattePath)
            .then(p => {
                if (disposed) {
                    p.dispose();
                    return;
                }
                player = p;
                playerRef.current = p;
            })
            .catch(err => captureError(err, { flow: 'camera_matte', phase: 'mask_load' }));
        return () => {
            disposed = true;
            if (playerRef.current === player) playerRef.current = null;
            player?.dispose();
        };
    }, [mattePath, url]);

    return playerRef;
}
