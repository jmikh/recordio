import React from 'react';
import type { Clip } from '../../core/types';
import { ClipImpl } from '../../core/timeline/Clip';

interface TimelineTrackVideoProps {
    clips: Clip[];
    pixelsPerSec: number;
    trackHeight: number;
    onDragStart: (e: React.MouseEvent, id: string, type: 'left' | 'right') => void;
}

export const TimelineTrackVideo: React.FC<TimelineTrackVideoProps> = ({ clips, pixelsPerSec, trackHeight, onDragStart }) => {
    return (
        <div className="relative w-full" style={{ height: trackHeight }}>
            {clips.map((clip) => {
                const durationMs = ClipImpl.getDuration(clip);
                const left = (clip.timelineInMs / 1000) * pixelsPerSec;
                const width = (durationMs / 1000) * pixelsPerSec;

                return (
                    <div
                        key={clip.id}
                        className="absolute top-0 bottom-0 bg-green-600/90 border border-green-500/50 rounded-md overflow-hidden group hover:brightness-110 transition-all cursor-pointer box-border"
                        style={{ left: `${left}px`, width: `${width}px` }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center px-2 h-full gap-2 text-xs font-medium text-white shadow-sm">
                            <span>🎥 Clip</span>
                            <span className="opacity-70 font-normal">{(durationMs / 1000).toFixed(1)}s</span>
                        </div>

                        <div
                            className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                            onMouseDown={(e) => onDragStart(e, clip.id, 'left')}
                        />
                        <div
                            className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/30 z-20"
                            onMouseDown={(e) => onDragStart(e, clip.id, 'right')}
                        />
                    </div>
                );
            })}
        </div>
    );
};
