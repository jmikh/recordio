import React from 'react';
import type { IconType } from 'react-icons';
import { Button, Tooltip } from '@shared/components';

interface TimelineHeaderCellProps {
    icon: IconType;
    /** Track name — the button's accessible name and the default tooltip subject */
    title: string;
    height: number;
    /** When true the track is squeezed to a sliver, so the icon shrinks to fit */
    isCollapsed?: boolean;
    /** When provided, the icon becomes a button that toggles the track's apply state */
    applyEnabled?: boolean;
    onToggleApply?: () => void;
}

/**
 * Unified header cell component for timeline track headers.
 * Icon-only: for effect tracks the icon itself is the enable/disable toggle —
 * dimmed with a slash through it while the effect is off.
 */
export const TimelineHeaderCell: React.FC<TimelineHeaderCellProps> = ({
    icon: Icon,
    title,
    height,
    isCollapsed = false,
    applyEnabled = true,
    onToggleApply,
}) => {
    const isToggle = onToggleApply !== undefined;
    // Icon + slash scale together so the collapsed sliver still shows the on/off state
    const glyphClass = `relative flex transition-transform duration-150 ${isCollapsed ? 'scale-[0.6]' : ''}`;

    const trigger = isToggle ? (
        <Button
            variant="ghost"
            onClick={(e) => {
                e.stopPropagation();
                onToggleApply();
            }}
            // Ghost resolves to main -> highlighted on hover; the off state drops
            // to disabled so the whole column reads at a glance.
            className={`transition-[color,transform] active:scale-90 ${applyEnabled ? '' : 'text-text-disabled hover:text-text-muted'}`}
            aria-label={title}
            aria-pressed={applyEnabled}
        >
            <span className={glyphClass}>
                <Icon className="icon-md" />
                <span
                    aria-hidden
                    className={`pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current ring-2 ring-surface transition-transform duration-150 ${applyEnabled ? 'scale-x-0' : 'scale-x-100'}`}
                />
            </span>
        </Button>
    ) : (
        <span className={`${glyphClass} px-1 text-text-muted`} aria-label={title} role="img">
            <Icon className="icon-md" />
        </span>
    );

    const tooltipText = isToggle ? `${applyEnabled ? 'Disable' : 'Enable'} ${title.toLowerCase()}` : title;

    return (
        <div
            className="flex items-center justify-center bg-surface rounded-sm overflow-hidden mx-1"
            style={{ height, minHeight: height, transition: 'height 150ms ease' }}
        >
            <Tooltip text={tooltipText} position="right">{trigger}</Tooltip>
        </div>
    );
};
