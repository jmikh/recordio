import type { ReactNode } from 'react';

/**
 * Camera shape picker icons: the same person bust inside a rectangle, a circle,
 * or a dotted frame (background removed). Drawn on Lucide's 24px grid at 2px
 * stroke with round caps so they sit beside Lucide icons; size with icon-* classes.
 */
const CameraShapeIcon = ({ className, children }: { className?: string; children: ReactNode }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
    >
        {children}
        <circle cx="12" cy="10" r="3" />
        <path d="M18 20a6 6 0 0 0-12 0" />
    </svg>
);

export const CameraRectIcon = ({ className }: { className?: string }) => (
    <CameraShapeIcon className={className}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
    </CameraShapeIcon>
);

export const CameraCircleIcon = ({ className }: { className?: string }) => (
    <CameraShapeIcon className={className}>
        <circle cx="12" cy="12" r="10" />
    </CameraShapeIcon>
);

export const CameraNoBackgroundIcon = ({ className }: { className?: string }) => (
    <CameraShapeIcon className={className}>
        <rect x="2" y="4" width="20" height="16" rx="2" strokeDasharray="0 4" />
    </CameraShapeIcon>
);
