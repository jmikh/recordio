import { useState } from 'react';
import { MdBugReport } from 'react-icons/md';
import { captureBugReport } from '../../utils/sentry';
import { Button } from './Button';
import { PrimaryButton } from './PrimaryButton';
import { XButton } from './XButton';

interface BugReportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim()) return;

        setIsSubmitting(true);

        try {
            // Capture additional context
            const context = {
                userAgent: navigator.userAgent,
                extensionVersion: chrome.runtime.getManifest().version,
                timestamp: new Date().toISOString(),
                url: window.location.href,
            };

            captureBugReport(description, context);

            setSubmitted(true);
            setTimeout(() => {
                onClose();
                setDescription('');
                setSubmitted(false);
            }, 2000);
        } catch (error) {
            console.error('Failed to submit bug report:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-surface-raised rounded-lg p-6 w-full border border-border">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <MdBugReport className="text-primary" size={24} />
                        <h2 className="text-lg font-semibold text-text-highlighted">Report a Bug</h2>
                    </div>
                    <XButton
                        onClick={onClose}
                        title="Close"
                    />
                </div>

                {submitted ? (
                    <div className="py-8 text-center">
                        <p className="text-primary font-medium mb-2">Thank you!</p>
                        <p className="text-text-main text-sm">
                            Your bug report has been submitted.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <label htmlFor="bug-description" className="block text-sm font-medium text-text-highlighted mb-2">
                                What went wrong?
                            </label>
                            <textarea
                                id="bug-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full h-32 px-3 py-2 bg-surface border border-border rounded-md text-text-highlighted placeholder:text-text-main focus-ring resize-none"
                                placeholder="Please describe the issue you encountered..."
                                required
                                autoFocus
                            />
                        </div>

                        <div className="text-xs text-text-main mb-4">
                            We'll automatically include technical details like your browser version and extension version to help us fix the issue.
                        </div>

                        <div className="flex gap-2 justify-end">
                            <Button
                                type="button"
                                onClick={onClose}
                            >
                                Cancel
                            </Button>
                            <PrimaryButton
                                type="submit"
                                disabled={!description.trim() || isSubmitting}
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit Report'}
                            </PrimaryButton>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
