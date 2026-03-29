import React from 'react';
import { MdVolumeUp, MdVolumeOff } from 'react-icons/md';
import { IoEye, IoEyeOff } from 'react-icons/io5';

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
    /** When provided, renders an eye icon button to toggle the apply state */
    applyEnabled?: boolean;
    onToggleApply?: () => void;
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
    applyEnabled,
    onToggleApply,
}) => {
    return (
        <div
            className="flex items-center justify-between px-3 bg-surface-raised rounded-sm overflow-hidden mx-1"
            style={{ height, minHeight: height, transition: 'height 150ms ease' }}
        >
            {!isCollapsed && (
                <>
                    {titleElement ?? (
                        <span
                            className={`truncate select-none ${disabled ? 'text-text-muted' : 'text-text-main'}`}
                            style={{ fontSize: 14 }}
                            title={title}
                        >
                            {title}
                        </span>
                    )}

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
                        {onToggleApply !== undefined && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleApply();
                                }}
                                className={`p-1 rounded hover:bg-white/10 transition-colors ${applyEnabled ? 'text-text-muted hover:text-text-highlighted' : 'text-text-disabled hover:text-text-muted'}`}
                                title={applyEnabled ? 'Disable effect' : 'Enable effect'}
                            >
                                {applyEnabled ? <IoEye size={13} /> : <IoEyeOff size={13} />}
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

