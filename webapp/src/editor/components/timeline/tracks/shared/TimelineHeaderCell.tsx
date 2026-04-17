import React from 'react';
import { MdVolumeUp, MdVolumeOff } from 'react-icons/md';
import { AiOutlineEye, AiOutlineEyeInvisible } from 'react-icons/ai';
import { Button } from '@shared/components';

interface TimelineHeaderCellProps {
    icon?: React.ReactNode;
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
    icon,
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
            className="flex items-center justify-between pl-3 pr-1 bg-surface-raised rounded-sm overflow-hidden mx-1"
            style={{ height, minHeight: height, transition: 'height 150ms ease' }}
        >
            {!isCollapsed && (
                <>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {icon && (
                            <span className={`flex-shrink-0 ${disabled ? 'text-text-muted' : 'text-text-main'}`}>
                                {icon}
                            </span>
                        )}
                        {titleElement ?? (
                            <span
                                className={`truncate select-none ${disabled ? 'text-text-muted' : 'text-text-main'}`}
                                style={{ fontSize: 14 }}
                                title={title}
                            >
                                {title}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        {infoElement}
                        {hasAudio && onToggleMute && (
                            <Button
                                variant="icon"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMute();
                                }}
                                className={isMuted ? '!text-destructive' : ''}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                {isMuted ? <MdVolumeOff className="icon-sm" /> : <MdVolumeUp className="icon-sm" />}
                            </Button>
                        )}
                        {onToggleApply !== undefined && (
                            <Button
                                variant="icon"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleApply();
                                }}
                                className={!applyEnabled ? '!text-text-disabled hover:!text-text-muted' : '!text-text-muted hover:!text-text-highlighted'}
                                title={applyEnabled ? 'Disable effect' : 'Enable effect'}
                            >
                                {applyEnabled ? <AiOutlineEye className="icon-md" /> : <AiOutlineEyeInvisible className="icon-md" />}
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

