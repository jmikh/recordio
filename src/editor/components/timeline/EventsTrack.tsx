import React, { useMemo } from 'react';
import type { UserEvents } from '../../../core/types';
import { TimeMapper } from '../../../core/timeMapper';
import { TimePixelMapper } from '../../utils/timePixelMapper';

import { useUIStore } from '../../stores/useUIStore';

interface EventsTrackProps {
    events: UserEvents;
    timeMapper: TimeMapper;
    trackHeight: number;
}

export const EventsTrack: React.FC<EventsTrackProps> = ({
    events,
    timeMapper,
    trackHeight
}) => {
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);

    const coords = useMemo(() => {
        return new TimePixelMapper(timeMapper, pixelsPerSec);
    }, [timeMapper, pixelsPerSec]);

    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
    };

    return (
        <div className="w-full relative bg-surface-elevated flex" style={{ height: trackHeight }}>


            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>
                {/* Clicks */}
                {events.mouseClicks?.map((c, i) => {
                    const left = coords.sourceTimeToX(c.timestamp);
                    if (left === -1) return null;

                    return (
                        <div
                            key={`c-${i}`}
                            className="absolute top-3 w-2 h-2 rounded-full bg-yellow-500 hover:scale-125 transition-transform cursor-help"
                            style={{ left: `${left}px` }}
                            title={`Click at ${formatFullTime(c.timestamp)}`}
                        />
                    );
                })}

                {/* Drags */}
                {events.drags?.map((d, i) => {
                    const startMs = d.timestamp;
                    const endMs = d.endTime ?? startMs + 500;

                    const outputStart = timeMapper.mapSourceToOutputTime(startMs);
                    const outputEnd = timeMapper.mapSourceToOutputTime(endMs);

                    if (outputStart === -1) return null;

                    let width = 0;
                    if (outputEnd !== -1) {
                        width = coords.msToX(outputEnd - outputStart);
                    } else {
                        width = coords.msToX(500); // fallback width
                    }

                    const left = coords.msToX(outputStart);

                    return (
                        <div
                            key={`d-${i}`}
                            className="absolute top-4 h-1 bg-yellow-600/60 rounded-full"
                            style={{ left: `${left}px`, width: `${width}px` }}
                        />
                    );
                })}

                {/* Keyboard Events */}
                {events.keyboardEvents?.map((k, i) => {
                    const left = coords.sourceTimeToX(k.timestamp);
                    if (left === -1) return null;

                    return (
                        <div
                            key={`k-${i}`}
                            className="absolute top-6 w-2 h-2 rounded-sm bg-cyan-500 hover:scale-125 transition-transform cursor-help"
                            style={{ left: `${left}px` }}
                            title={`Key: ${k.key}`}
                        />
                    );
                })}
            </div>
        </div>
    );
};
