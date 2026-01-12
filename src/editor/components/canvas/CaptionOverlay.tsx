import { useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { CaptionTimeMapper } from '../../../core/CaptionTimeMapper';
import { TimeMapper } from '../../../core/timeMapper';
import type { CaptionSegment } from '../../../core/types';

/**
 * Caption overlay component that displays captions
 * synced to the current playback time.
 */
export function CaptionOverlay() {
    const project = useProjectStore(state => state.project);
    const currentTime = useUIStore(state => state.currentTimeMs);

    const captions = project.timeline.recording.captions;
    const settings = project.settings.captions || { visible: true, size: 24 };

    // Don't render if captions are disabled
    if (!settings.visible) {
        return null;
    }

    // Create caption time mapper
    const captionTimeMapper = useMemo(() => {
        if (!captions || captions.segments.length === 0) {
            return null;
        }

        const timeMapper = new TimeMapper(project.timeline.outputWindows);
        return new CaptionTimeMapper(captions.segments, timeMapper);
    }, [captions, project.timeline.outputWindows]);

    // Get visible captions at current time
    const visibleCaptions = useMemo(() => {
        if (!captionTimeMapper) return [];
        return captionTimeMapper.getCaptionsAtOutputTime(currentTime);
    }, [captionTimeMapper, currentTime]);

    if (!captions || visibleCaptions.length === 0) {
        return null;
    }

    return (
        <div className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none z-20">
            <div className="max-w-3xl px-4">
                {visibleCaptions.map((caption: CaptionSegment) => (
                    <div
                        key={caption.id}
                        className="bg-black/80 text-white px-4 py-2 rounded-lg text-center font-medium shadow-lg backdrop-blur-sm"
                        style={{
                            fontSize: `${settings.size}px`,
                            lineHeight: 1.4,
                            textShadow: '0 1px 2px rgba(0,0,0,0.8)'
                        }}
                    >
                        {caption.text}
                    </div>
                ))}
            </div>
        </div>
    );
}
