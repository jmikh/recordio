import { useState, useCallback, type MouseEvent } from 'react';
import { LuCheck, LuLink } from 'react-icons/lu';
import { Button } from './Button';

interface CopyLinkButtonProps {
    url: string;
    className?: string;
    title?: string;
    /** Fired after the URL reaches the clipboard — hosts use it to raise a toast */
    onCopied?: () => void;
}

// Button's `icon` takes a component, so the copied tick carries its own colour
// here (a class on the svg beats the button's inherited hover colour).
const CopiedIcon = ({ className = '' }: { className?: string }) => (
    <LuCheck className={`${className} text-success`} />
);

/**
 * Icon button that copies a URL to the clipboard.
 * Shows a check icon for 2s after copying. Stops event propagation.
 */
export const CopyLinkButton = ({ url, className = '', title = 'Copy link', onCopied }: CopyLinkButtonProps) => {
    const [copied, setCopied] = useState(false);

    const handleClick = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            onCopied?.();
        });
    }, [url, onCopied]);

    return (
        <Button
            variant="ghost"
            icon={copied ? CopiedIcon : LuLink}
            onClick={handleClick}
            className={className}
            aria-label={title}
            title={copied ? 'Copied!' : title}
        />
    );
};
