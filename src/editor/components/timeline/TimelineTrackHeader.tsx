import React from 'react';
import { MdVolumeUp, MdVolumeOff } from 'react-icons/md';

//TODO get rid of this and use css class instead
interface TimelineTrackHeaderProps {
    title: string;
    height: number;
    hasAudio?: boolean;
    isMuted?: boolean;
    onToggleMute?: () => void;
}

export const TimelineTrackHeader: React.FC<TimelineTrackHeaderProps> = ({
    title,
    height,
    hasAudio,
    isMuted,
    onToggleMute
}) => {
    return (
        <div
            className="flex items-center justify-between px-3 border-b border-border bg-surface-elevated box-border"
            style={{ height, minHeight: height }}
        >
            <span className="text-xs text-text-muted truncate select-none" title={title}>
                {title}
            </span>

            {hasAudio && onToggleMute && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleMute();
                    }}
                    className={`p-1 rounded hover:bg-white/10 transition-colors ${isMuted ? 'text-destructive' : 'text-text-muted hover:text-text-main'}`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? <MdVolumeOff size={14} /> : <MdVolumeUp size={14} />}
                </button>
            )}
        </div>
    );
};
