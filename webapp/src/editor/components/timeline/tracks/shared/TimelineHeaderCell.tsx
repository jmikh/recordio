import React from 'react';
import { MdVolumeUp, MdVolumeOff } from 'react-icons/md';

interface TimelineHeaderCellProps {
    title: string;
    height: number;
    hasAudio?: boolean;
    isMuted?: boolean;
    onToggleMute?: () => void;
    /** Optional element to show next to the title (e.g., legend icon) */
    infoElement?: React.ReactNode;
    /** Optional custom title element (e.g., tooltip-wrapped title). Replaces the default title span. */
    titleElement?: React.ReactNode;
    /** When true, dims the title text to indicate the track is inactive */
    disabled?: boolean;
    /** When true, shows a compact "…" placeholder instead of full header content */
    isCollapsed?: boolean;
}

/**
 * Unified header cell component for timeline track headers.
 * Provides consistent height, styling, and layout for all track headers.
 */
export const TimelineHeaderCell: React.FC<TimelineHeaderCellProps> = ({
    title,
    height,
    hasAudio,
    isMuted,
    onToggleMute,
    infoElement,
    titleElement,
    disabled,
    isCollapsed = false,
}) => {
    return (
        <div
            className="flex items-center justify-between px-3 bg-surface-raised rounded-sm overflow-hidden mx-1"
            style={{ height, minHeight: height, transition: 'height 150ms ease' }}
        >
            {titleElement ?? (
                <span
                    className={`truncate select-none ${disabled ? 'text-text-muted' : 'text-text-main'}`}
                    style={{ fontSize: isCollapsed ? 9 : 14, transition: 'font-size 150ms ease' }}
                    title={title}
                >
                    {title}
                </span>
            )}

            {!isCollapsed && (
                <div className="flex items-center gap-1">
                    {infoElement}
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
            )}
        </div>
    );
};

