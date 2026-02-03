import { useState, useEffect } from 'react';
import { useExtensionBridge } from '../hooks/useExtensionBridge';
import { importFromRawRecording } from '../storage/projectStorage';
import { LogoLink } from '@shared/components';

type ImportStatus =
    | 'init'
    | 'receiving'
    | 'streaming'
    | 'storing'
    | 'success'
    | 'error-no-id'
    | 'error-extension'
    | 'error-storage';

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ImportPage() {
    const [status, setStatus] = useState<ImportStatus>('init');
    const [_projectId, setProjectId] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const [hasStarted, setHasStarted] = useState(false);

    const { state, requestHandoff, confirmHandoff } = useExtensionBridge();

    // Get recording ID from URL
    const params = new URLSearchParams(window.location.search);
    const recordingId = params.get('id');

    // Start handoff when page loads
    useEffect(() => {
        if (!recordingId) {
            setStatus('error-no-id');
            return;
        }

        if (hasStarted) return;
        setHasStarted(true);

        console.log('[ImportPage] Initiating handoff for:', recordingId);
        requestHandoff(recordingId);
        setStatus('receiving');
    }, [recordingId, hasStarted, requestHandoff]);

    // Handle handoff state changes
    useEffect(() => {
        // Update status based on bridge state
        if (state.status === 'streaming') {
            setStatus('streaming');
        }

        if (state.status === 'success' && state.recording && state.screenVideo) {
            console.log('[ImportPage] Received recording, storing...');
            setStatus('storing');

            importFromRawRecording(
                state.recording,
                state.screenVideo,
                state.cameraVideo || undefined
            )
                .then((project) => {
                    console.log('[ImportPage] Stored as project:', project.id);
                    setProjectId(project.id);
                    setStatus('success');
                    confirmHandoff(project.id);

                    setTimeout(() => {
                        window.location.href = `/editor?projectId=${project.id}`;
                    }, 1500);
                })
                .catch((error) => {
                    console.error('[ImportPage] Storage failed:', error);
                    setStatus('error-storage');
                    setErrorDetails(error.message);
                });
        }

        if (state.status === 'error') {
            setStatus('error-extension');
            setErrorDetails(state.error);
        }
    }, [state, confirmHandoff]);

    const getStatusMessage = () => {
        switch (status) {
            case 'init': return 'Initializing...';
            case 'receiving': return 'Connecting to extension...';
            case 'streaming': return 'Transferring recording...';
            case 'storing': return 'Saving to your library...';
            case 'success': return 'Success! Opening editor...';
            case 'error-no-id': return 'No recording ID provided';
            case 'error-extension': return 'Failed to receive recording';
            case 'error-storage': return 'Failed to save recording';
        }
    };

    const isError = status.startsWith('error');
    const progress = state.progress;

    // Calculate progress percentage
    const progressPercent = progress && progress.totalBytes > 0
        ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
        : 0;

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex flex-col items-center justify-center">
            <LogoLink />

            <div className="mt-8 text-center max-w-md">
                <div className={`text-lg ${isError ? 'text-red-400' : 'text-text-main'}`}>
                    {getStatusMessage()}
                </div>

                {errorDetails && (
                    <div className="mt-2 text-sm text-text-muted">
                        {errorDetails}
                    </div>
                )}

                {/* Progress bar for streaming */}
                {status === 'streaming' && progress && (
                    <div className="mt-6 w-full">
                        {/* Progress bar */}
                        <div className="w-full h-2 bg-surface-raised rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300 ease-out"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        {/* Progress text */}
                        <div className="mt-2 flex justify-between text-sm text-text-muted">
                            <span>{progressPercent}%</span>
                            <span>
                                {formatBytes(progress.bytesReceived)} / {formatBytes(progress.totalBytes)}
                            </span>
                        </div>

                        {/* Chunk info */}
                        {progress.totalChunks > 0 && (
                            <div className="mt-1 text-xs text-text-muted">
                                {progress.source === 'screen' ? '📺 Screen' : '📹 Camera'} •
                                Chunk {progress.chunksReceived} of {progress.totalChunks}
                            </div>
                        )}
                    </div>
                )}

                {/* Loading spinner for non-streaming states */}
                {!isError && status !== 'success' && status !== 'streaming' && (
                    <div className="mt-4">
                        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
                    </div>
                )}

                {isError && (
                    <button
                        onClick={() => window.location.href = '/'}
                        className="mt-4 px-4 py-2 bg-surface-raised hover:bg-hover rounded-lg text-sm"
                    >
                        Go to Dashboard
                    </button>
                )}
            </div>
        </div>
    );
}
