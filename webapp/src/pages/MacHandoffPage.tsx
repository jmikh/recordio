/**
 * Mac Handoff Page — shown when the RecordioMac native app opens the editor
 * after a recording is completed. Shows initialization progress and errors.
 *
 * Flow:
 * 1. WKWebView loads /mac-handoff
 * 2. This page sends READY to Swift via NativeBridge
 * 3. Swift sends recording metadata + video URL
 * 4. Page shows "Importing..." → imports → navigates to editor
 * 5. On error → shows error + "Go to Dashboard" button
 */

import { useState, useEffect, useRef } from 'react';
import { importFromRawRecording } from '../storage/projectStorage';
import { isRecordioMacApp, sendToNative } from '../bridge/macBridge';
import { LogoLink } from '@shared/components';

type HandoffStatus = 'waiting' | 'importing' | 'success' | 'error';

export function MacHandoffPage() {
    const [status, setStatus] = useState<HandoffStatus>('waiting');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        if (!isRecordioMacApp()) {
            setStatus('error');
            setErrorMessage('This page can only be opened from the Recordio Mac app.');
            return;
        }

        // Register the bridge listener for recording data
        (window as any).recordioMacBridge = {
            onRecordingReady: async (metadata: any, videoUrl: string, cameraUrl: string | null, micUrl: string | null) => {
                console.log('[MacHandoff] Recording received:', metadata.id);
                setStatus('importing');

                try {
                    // Fetch video from native scheme
                    const response = await fetch(videoUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch video: ${response.status}`);
                    }
                    const videoBlob = await response.blob();
                    console.log(`[MacHandoff] Video: ${(videoBlob.size / 1024 / 1024).toFixed(1)} MB`);

                    // Fetch camera if available
                    let cameraBlob: Blob | undefined;
                    if (cameraUrl) {
                        const camResponse = await fetch(cameraUrl);
                        if (camResponse.ok) {
                            cameraBlob = await camResponse.blob();
                            console.log(`[MacHandoff] Camera: ${(cameraBlob.size / 1024 / 1024).toFixed(1)} MB`);
                        } else {
                            console.warn(`[MacHandoff] Camera fetch failed: ${camResponse.status}`);
                        }
                    }

                    // Fetch mic if available
                    let micBlob: Blob | undefined;
                    if (micUrl) {
                        const micResponse = await fetch(micUrl);
                        if (micResponse.ok) {
                            micBlob = await micResponse.blob();
                            console.log(`[MacHandoff] Mic: ${(micBlob.size / 1024 / 1024).toFixed(1)} MB`);
                        } else {
                            console.warn(`[MacHandoff] Mic fetch failed: ${micResponse.status}`);
                        }
                    }

                    // Import recording with all media
                    const project = await importFromRawRecording(metadata, videoBlob, cameraBlob, micBlob);
                    console.log(`[MacHandoff] Project created: ${project.id}`);

                    setStatus('success');
                    sendToNative('HANDOFF_COMPLETE', { projectId: project.id });

                    // Navigate to editor
                    setTimeout(() => {
                        window.location.href = `/editor?projectId=${project.id}`;
                    }, 800);
                } catch (error: any) {
                    console.error('[MacHandoff] Import failed:', error);
                    setStatus('error');
                    setErrorMessage(error.message || 'Failed to import recording');
                    sendToNative('HANDOFF_ERROR', { error: String(error) });
                }
            }
        };

        // Check for pending recording that arrived before this page loaded
        if ((window as any).__recordioPendingRecording) {
            const { metadata, videoUrl, cameraUrl, micUrl } = (window as any).__recordioPendingRecording;
            delete (window as any).__recordioPendingRecording;
            (window as any).recordioMacBridge.onRecordingReady(metadata, videoUrl, cameraUrl, micUrl);
        } else {
            // Signal to Swift that we're ready to receive
            sendToNative('READY');
        }
    }, []);

    const getStatusText = () => {
        switch (status) {
            case 'waiting': return 'Initializing Project...';
            case 'importing': return 'Importing Recording...';
            case 'success': return 'Opening Editor...';
            case 'error': return 'Import Failed';
        }
    };

    const isError = status === 'error';

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--color-surface-body)',
            color: 'var(--color-text-main)',
            fontFamily: 'var(--font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
        }}>
            <LogoLink />

            <div style={{ marginTop: 32, textAlign: 'center', maxWidth: 400, width: '100%', padding: '0 24px' }}>
                <div style={{
                    fontSize: 18,
                    fontWeight: 500,
                    color: isError ? 'var(--color-danger, #ef4444)' : 'var(--color-text-main)',
                }}>
                    {getStatusText()}
                </div>

                {errorMessage && (
                    <div style={{
                        marginTop: 8,
                        fontSize: 13,
                        color: 'var(--color-text-muted)',
                        lineHeight: 1.5,
                    }}>
                        {errorMessage}
                    </div>
                )}

                {/* Indeterminate progress bar */}
                {!isError && status !== 'success' && (
                    <div style={{ marginTop: 24, width: '100%' }}>
                        <div style={{
                            width: '100%',
                            height: 3,
                            backgroundColor: 'var(--color-surface-raised)',
                            borderRadius: 4,
                            overflow: 'hidden',
                            position: 'relative',
                        }}>
                            <div style={{
                                position: 'absolute',
                                height: '100%',
                                width: '40%',
                                backgroundColor: 'var(--color-primary)',
                                borderRadius: 4,
                                animation: 'mac-handoff-slide 1.5s ease-in-out infinite',
                            }} />
                        </div>
                    </div>
                )}

                {/* Success checkmark */}
                {status === 'success' && (
                    <div style={{ marginTop: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
                        ✓ Project ready
                    </div>
                )}

                {isError && (
                    <button
                        onClick={() => window.location.href = '/'}
                        style={{
                            marginTop: 16,
                            padding: '8px 16px',
                            backgroundColor: 'var(--color-surface-raised)',
                            border: 'none',
                            borderRadius: 8,
                            color: 'var(--color-text-main)',
                            fontSize: 13,
                            cursor: 'pointer',
                        }}
                    >
                        Go to Dashboard
                    </button>
                )}
            </div>

            {/* Keyframe animation for indeterminate progress */}
            <style>{`
                @keyframes mac-handoff-slide {
                    0% { left: -40%; }
                    100% { left: 100%; }
                }
            `}</style>
        </div>
    );
}
