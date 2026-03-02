import { useEffect } from 'react';
import { trackExtensionInstalled } from '../core/analytics';
import logoBackground from '@shared/assets/logo.svg';

const steps = [
    {
        number: 1,
        title: 'Pin the Extension',
        description: 'Click the puzzle piece icon in your toolbar, then click the pin icon next to Recordio to keep it visible.',
        screenshot: '/assets/welcome/pin.png',
    },
    {
        number: 2,
        title: 'Start Recording',
        description: 'Click the Recordio icon in your toolbar, choose Tab, Window, or Screen mode, then hit Record.',
        screenshot: '/assets/welcome/start.png',
    },
    {
        number: 3,
        title: 'Finish Recording',
        description: 'When you\'re done, click the Recordio icon and hit Finish Recording. Your recording will open in the editor automatically.',
        screenshot: '/assets/welcome/pause.png',
    },
];

export function WelcomePage() {
    useEffect(() => {
        trackExtensionInstalled();
    }, []);

    return (
        <div className="min-h-screen bg-surface-body text-text-main">
            {/* Hero */}
            <div className="max-w-3xl mx-auto px-6 pt-16 pb-10 text-center">
                <div className="flex items-center justify-center gap-4 mb-3">
                    <img src={logoBackground} alt="Recordio" className="w-10 h-10" />
                    <h1 className="text-3xl font-semibold text-text-highlighted">
                        Welcome to Recordio
                    </h1>
                </div>
                <p className="text-text-muted text-lg">
                    You're all set. Here's how to make your first recording.
                </p>
            </div>

            {/* Steps */}
            <div className="mx-auto px-6 pb-20 flex items-start justify-center gap-6">
                {steps.map((step) => (
                    <div
                        key={step.number}
                        className="bg-surface-raised border border-border rounded-lg p-5 flex flex-col gap-3"
                        style={{ width: 380 }}
                    >
                        {/* Step header */}
                        <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-text-on-primary text-xs font-semibold shrink-0">
                                {step.number}
                            </div>
                            <h2 className="text-base font-medium text-text-highlighted">
                                {step.title}
                            </h2>
                        </div>

                        <p className="text-text-muted text-sm leading-relaxed">
                            {step.description}
                        </p>

                        {/* Screenshot */}
                        <img
                            src={step.screenshot}
                            alt={step.title}
                            className="rounded-md w-full"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
