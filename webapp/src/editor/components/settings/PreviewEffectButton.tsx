import { LuPlay, LuSquare } from 'react-icons/lu';
import { Button, Tooltip } from '@shared/components';
import type { DemoKind } from '../../../core/effectDemos';
import { useDefaultsPreviewStore } from '../../stores/useDefaultsPreviewStore';

/**
 * "Preview" play button for a time-based effect on the Personal Settings
 * page (plans/user-default-project-settings §3.8). Only rendered in
 * template mode — the editor has a timeline to scrub instead. Plays the
 * effect's demo on the preview canvas; while it runs the button becomes
 * a stop button.
 */
export function PreviewEffectButton({ kind, label, disabled }: { kind: DemoKind; label: string; disabled?: boolean }) {
    const playing = useDefaultsPreviewStore(s => s.playing);
    const play = useDefaultsPreviewStore(s => s.play);
    const stop = useDefaultsPreviewStore(s => s.stop);
    const isPlaying = playing === kind;

    return (
        <Tooltip text={isPlaying ? 'Stop preview' : label}>
            <Button
                variant="ghost"
                icon={isPlaying ? LuSquare : LuPlay}
                aria-label={isPlaying ? 'Stop preview' : label}
                disabled={disabled && !isPlaying}
                onClick={() => (isPlaying ? stop() : play(kind))}
            />
        </Tooltip>
    );
}
