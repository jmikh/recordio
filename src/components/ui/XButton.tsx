interface XButtonProps {
    onClick: (e: React.MouseEvent) => void;
    title?: string;
    className?: string;
}

/**
 * Reusable X button with circular dark background that becomes red on hover.
 */
export const XButton = ({ onClick, title = "Remove", className = "" }: XButtonProps) => {
    return (
        <button
            onClick={onClick}
            className={`w-5 h-5 rounded-full flex items-center justify-center bg-surface-body/60 transition-colors ${className}`}
            title={title}
        >
            <svg className="w-3 h-3 text-white hover:text-destructive transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );
};
