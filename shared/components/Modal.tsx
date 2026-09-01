import { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose?: () => void;
    children: ReactNode;
    /** Max width class, e.g. 'max-w-[400px]' or 'max-w-md' */
    maxWidth?: string;
    /** Optional className for the modal panel */
    className?: string;
    /** Accessible dialog name, e.g. "Sign in" — lets tests/screen readers target getByRole('dialog', { name }) */
    ariaLabel?: string;
}

/**
 * Base Modal component with centralized backdrop and panel styling.
 * Uses React Portal to render at document.body level, ensuring proper
 * z-index stacking above all content including the timeline.
 * Uses z-index 9999 to ensure it's definitively above all other elements.
 */
export function Modal({
    isOpen,
    onClose,
    children,
    maxWidth = 'max-w-[500px]',
    className = '',
    ariaLabel,
}: ModalProps) {
    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        // Only close if clicking the backdrop itself, not the modal content
        if (e.target === e.currentTarget && onClose) {
            onClose();
        }
    };

    const modalContent = (
        <div
            className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                className={`bg-surface-raised rounded-lg p-6 w-full border border-border ${maxWidth} ${className}`}
            >
                {children}
            </div>
        </div>
    );

    // Use Portal to render at body level, outside of any stacking contexts
    return createPortal(modalContent, document.body);
}
