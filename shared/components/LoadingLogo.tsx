import logoSvg from '../assets/logo.svg';
import './LoadingLogo.css';

interface LoadingLogoProps {
    /** Visible message under the mark — e2e tests wait for it to disappear. */
    text?: string;
    /** Extra classes on the overlay (e.g. a radius matching the parent). */
    className?: string;
    /** Dim a rounded panel behind just the mark and message, leaving the rest
     *  of the parent visible (e.g. the canvas painting the project background). */
    panel?: boolean;
}

/**
 * Full-parent loading state: the Recordio mark and a message held at a fixed
 * size in the middle of the container. Four quarter slices step around the
 * mark's plate in discrete frames to signal work in progress.
 *
 * Transparent by default — the parent supplies the backdrop (e.g. the media
 * surface where the canvas will sit), or `panel` dims only around the content.
 * It is absolutely positioned, so the parent must be `relative`.
 */
export const LoadingLogo = ({ text = 'Loading...', className, panel }: LoadingLogoProps) => (
    <div
        role="status"
        aria-live="polite"
        className={`absolute inset-0 z-[var(--z-index-overlay)] flex items-center justify-center ${className || ''}`}
    >
        <div className={`flex flex-col items-center gap-4 ${panel ? 'px-6 py-5 rounded-[var(--radius-lg)] bg-surface-media/70' : ''}`}>
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
    </div>
);
