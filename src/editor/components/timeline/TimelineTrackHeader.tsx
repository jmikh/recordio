import React from 'react';
import { MdVolumeUp, MdVolumeOff } from 'react-icons/md';

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
            className="flex items-center justify-between px-3 border-b border-white/10 bg-[#252525] box-border"
            style={{ height, minHeight: height }}
        >
            <span className="text-xs font-medium text-gray-300 truncate select-none" title={title}>
                {title}
            </span>

            {hasAudio && onToggleMute && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleMute();
                    }}
                    className={`p-1 rounded hover:bg-white/10 transition-colors ${isMuted ? 'text-red-400' : 'text-gray-400 hover:text-white'}`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? <MdVolumeOff size={14} /> : <MdVolumeUp size={14} />}
                </button>
            )}
        </div>
    );
};
