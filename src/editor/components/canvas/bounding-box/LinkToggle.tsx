import React from 'react';

export interface LinkToggleProps {
    /** Whether corners are currently linked */
    linked: boolean;
    /** Callback when toggle is clicked */
    onToggle: (linked: boolean) => void;
}

/**
 * Floating toggle button for linking/unlinking corner radii.
 * Appears above the bounding box during corner radius editing.
 */
export const LinkToggle: React.FC<LinkToggleProps> = ({ linked, onToggle }) => {
    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onToggle(!linked);
            }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded shadow-md border transition-colors ${linked
                ? 'bg-primary/20 border-primary/50 hover:bg-primary/30'
                : 'bg-surface-overlay/90 border-border/50 hover:bg-surface-overlay'
                }`}
            title={linked ? 'Unlink corners (edit independently)' : 'Link corners (edit together)'}
            style={{ pointerEvents: 'auto' }}
        >
            {/* Chain link icon */}
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: linked ? 'var(--primary)' : 'var(--text-muted)' }}
            >
                {linked ? (
                    // Linked chain
                    <>
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </>
                ) : (
                    // Broken chain
                    <>
                        <path d="M9 17H7A5 5 0 0 1 7 7" />
                        <path d="M15 7h2a5 5 0 0 1 4 8" />
                        <line x1="8" y1="12" x2="12" y2="12" />
                    </>
                )}
            </svg>
            <span className={`text-xs ${linked ? 'text-primary' : 'text-text-secondary'}`}>
                {linked ? 'Linked' : 'Unlinked'}
            </span>
        </button>
    );
};
