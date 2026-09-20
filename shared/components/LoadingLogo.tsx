import logoSvg from '../assets/logo.svg';
import './LoadingLogo.css';

interface LoadingLogoProps {
    /** Visible message under the mark — e2e tests wait for it to disappear. */
    text?: string;
    /** Extra classes on the overlay (e.g. a radius matching the parent). */
    className?: string;
}

/**
 * Full-parent loading state: the Recordio mark and a message held at a fixed
 * size in the middle of the container. Four quarter slices step around the
 * mark's plate in discrete frames to signal work in progress.
 *
 * Transparent by default — the parent supplies the backdrop (e.g. the media
 * surface where the canvas will sit). It is absolutely positioned, so the
 * parent must be `relative`.
 */
export const LoadingLogo = ({ text = 'Loading...', className }: LoadingLogoProps) => (
    <div
        role="status"
        aria-live="polite"
        className={`absolute inset-0 z-[var(--z-index-overlay)] flex flex-col items-center justify-center gap-4 ${className || ''}`}
    >
        <div className="loading-logo-mark w-16 h-16">
            <img src={logoSvg} alt="" className="w-full h-full" />
            <span className="loading-logo-pie" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
            </span>
        </div>
        <span className="text-sm text-text-on-media">{text}</span>
    </div>
);
