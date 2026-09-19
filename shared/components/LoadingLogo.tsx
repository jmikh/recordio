import logoSvg from '../assets/logo.svg';
import './LoadingLogo.css';

interface LoadingLogoProps {
    /** Visible message under the mark — e2e tests wait for it to disappear. */
    text?: string;
    /** Extra classes on the scrim (e.g. a radius matching the parent). */
    className?: string;
}

/**
 * Full-parent loading state: a dimming scrim that fills its container, with the
 * Recordio mark and a message held at a fixed size in the middle. A reflection
 * loops across the mark to signal work in progress.
 *
 * The scrim is absolutely positioned, so the parent must be `relative`.
 */
export const LoadingLogo = ({ text = 'Loading...', className }: LoadingLogoProps) => (
    <div
        role="status"
        aria-live="polite"
        className={`absolute inset-0 z-[var(--z-index-overlay)] flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm ${className || ''}`}
    >
        <div className="loading-logo-mark w-16 h-16">
            <img src={logoSvg} alt="" className="w-full h-full" />
            <span className="loading-logo-shine" aria-hidden="true" />
        </div>
        <span className="text-sm text-text-on-primary">{text}</span>
    </div>
);
