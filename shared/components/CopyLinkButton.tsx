import { useState, useCallback, type MouseEvent } from 'react';
import { LuLink, LuCheck } from 'react-icons/lu';

interface CopyLinkButtonProps {
    url: string;
    className?: string;
    title?: string;
}

/**
 * Icon button that copies a URL to the clipboard.
 * Shows a check icon for 2s after copying. Stops event propagation.
 */
export const CopyLinkButton = ({ url, className = '', title = 'Copy link' }: CopyLinkButtonProps) => {
    const [copied, setCopied] = useState(false);

    const handleClick = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [url]);

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`interactive-icon ${className}`}
            title={copied ? 'Copied!' : title}
        >
            {copied ? <LuCheck className="icon-sm text-success" /> : <LuLink className="icon-sm" />}
        </button>
    );
};
