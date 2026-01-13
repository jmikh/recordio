import React, { useMemo } from 'react';
import { useProjectTimeline } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { TimeMapper } from '../../../core/timeMapper';

interface CaptionsTrackProps {
    trackHeight: number;
}

export const CaptionsTrack: React.FC<CaptionsTrackProps> = ({
    trackHeight
}) => {
    const timeline = useProjectTimeline();
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const captions = timeline.recording.captions;

    const timeMapper = useMemo(() => {
        return new TimeMapper(timeline.outputWindows);
    }, [timeline.outputWindows]);

    if (!captions || captions.segments.length === 0) {
        return null;
    }

    return (
        <div className="w-full relative bg-surface-elevated flex" style={{ height: trackHeight }}>
            <div className="relative flex-1" style={{ height: trackHeight }}>
                {captions.segments.map((segment) => {
                    const range = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);

                    if (!range) return null;

                    const left = (range.start / 1000) * pixelsPerSec;
                    const width = ((range.end - range.start) / 1000) * pixelsPerSec;

                    // Skip if too small to be visible
                    if (width < 2) return null;

                    return (
                        <div
                            key={segment.id}
                            className="absolute top-1 bottom-1 bg-black border border-primary/50 rounded overflow-hidden flex items-center justify-center px-1"
                            style={{
                                left: `${left}px`,
                                width: `${width}px`
                            }}
                            title={segment.text}
                        >
                            <span className="text-xs leading-tight text-text-main whitespace-nowrap overflow-hidden text-ellipsis w-full text-center">
                                {segment.text}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
