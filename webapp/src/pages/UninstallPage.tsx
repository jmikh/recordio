import { useEffect } from 'react';
import { trackExtensionUninstalled } from '../analytics';
import logoBackground from '@shared/assets/logo.svg';
import { SUPPORT_EMAIL } from '@shared/types/bridge';

export function UninstallPage() {
    useEffect(() => {
        trackExtensionUninstalled();
    }, []);

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex items-center justify-center">
            <div className="max-w-md text-center px-6">
                <img src={logoBackground} alt="Recordio" className="w-14 h-14 mx-auto mb-6" />

                <h1 className="text-2xl font-semibold text-text-highlighted mb-3">
                    Sad to see you go
                </h1>

                <p className="text-text-muted text-base leading-relaxed">
                    We appreciate you trying Recordio. If there's anything we could
                    have done better, we'd love to hear from you at{' '}
                    <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary-highlighted underline cursor-pointer"
                    >
                        {SUPPORT_EMAIL}
                    </a>.
                </p>

                <p className="text-text-disabled text-xs mt-8">
                    You can always reinstall Recordio from the Chrome Web Store.
                </p>
            </div>
        </div>
    );
}
