import React from 'react';
import { LuEye, LuEyeOff, LuVolume2, LuVolumeOff } from 'react-icons/lu';
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
    isCollapsed = false,
    applyEnabled,
    onToggleApply,
}) => {
    return (
        <div
            className="flex items-center justify-between pl-3 pr-1 bg-surface rounded-sm overflow-hidden mx-1"
            style={{ height, minHeight: height, transition: 'height 150ms ease' }}
        >
            {!isCollapsed && (
                <>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {icon && (
                            <span className="flex-shrink-0 text-label">
                                {icon}
                            </span>
                        )}
                        {titleElement ?? (
                            <span
                                className="truncate select-none text-label"
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
                                variant="ghost"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMute();
                                }}
                                className={isMuted ? 'text-destructive' : ''}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                {isMuted ? <LuVolumeOff className="icon-sm" /> : <LuVolume2 className="icon-sm" />}
                            </Button>
                        )}
                        {onToggleApply !== undefined && (
                            <Button
                                variant="ghost"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleApply();
                                }}
                                // Ghost already resolves to muted -> highlighted on hover,
                                // so only the hidden state needs its own dimmer treatment.
                                className={!applyEnabled ? 'text-text-disabled hover:text-text-muted' : ''}
                                icon={applyEnabled ? LuEye : LuEyeOff}
                                aria-label={applyEnabled ? 'Disable effect' : 'Enable effect'}
                                title={applyEnabled ? 'Disable effect' : 'Enable effect'}
                            />
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

