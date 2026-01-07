import React from 'react';
import type { UserEvents } from '../../../core/types';
import { TimeMapper } from '../../../core/timeMapper';


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
    // Shared helper for mapping time
    const mapToLeft = (timeMs: number) => {
        const outputTime = timeMapper.mapSourceToOutputTime(timeMs);
        if (outputTime === -1) return null;
        return (outputTime / 1000) * pixelsPerSec;
    };

    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
    };

    return (
        <div className="w-full relative bg-[#252526] flex" style={{ height: trackHeight }}>


            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>
                {/* Clicks */}
                {events.mouseClicks?.map((c, i) => {
                    const left = mapToLeft(c.timestamp);
                    if (left === null) return null;

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
                    const endMs = (d.endTime !== undefined)
                        ? d.endTime
                        : (d.path && d.path.length > 0)
                            ? d.path[d.path.length - 1].timestamp
                            : startMs + 500;

                    const outputStart = timeMapper.mapSourceToOutputTime(startMs);
                    const outputEnd = timeMapper.mapSourceToOutputTime(endMs);

                    if (outputStart === -1) return null;

                    let width = 0;
                    if (outputEnd !== -1) {
                        width = ((outputEnd - outputStart) / 1000) * pixelsPerSec;
                    } else {
                        width = (0.5) * pixelsPerSec; // fallback width
                    }

                    const left = (outputStart / 1000) * pixelsPerSec;

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
                    const left = mapToLeft(k.timestamp);
                    if (left === null) return null;

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
