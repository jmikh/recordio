import React from 'react';
import { MdVolumeUp, MdVolumeOff } from 'react-icons/md';

//TODO get rid of this and use css class instead
interface TimelineTrackHeaderProps {
    title: string;
    height: number;
    hasAudio?: boolean;
    isMuted?: boolean;
    onToggleMute?: () => void;
    /** Optional element to show next to the title (e.g., info icon) */
    infoElement?: React.ReactNode;
}

export const TimelineTrackHeader: React.FC<TimelineTrackHeaderProps> = ({
    title,
    height,
    hasAudio,
    isMuted,
    onToggleMute,
    infoElement
}) => {
    return (
        <div
            className="flex items-center justify-between px-3 bg-surface"
            style={{ height, minHeight: height }}
        >
            <div className="flex items-center gap-1.5">
                <span className="text-sm text-text-main truncate select-none" title={title}>
                    {title}
                </span>
                {infoElement}
            </div>

            {hasAudio && onToggleMute && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleMute();
                    }}
                    className={`p-1 rounded hover:bg-white/10 transition-colors ${isMuted ? 'text-destructive' : 'text-text-main hover:text-text-highlighted'}`}
                    title={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? <MdVolumeOff size={14} /> : <MdVolumeUp size={14} />}
                </button>
            )}
        </div>
    );
};
