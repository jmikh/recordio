import { useState, useEffect } from 'react';
import { useExtensionBridge } from '../hooks/useExtensionBridge';
import { importFromRawRecording } from '../storage/projectStorage';
import { LogoLink } from '../../components/ui/LogoLink';

type ImportStatus =
    | 'init'
    | 'receiving'
    | 'storing'
    | 'success'
    | 'error-no-id'
    | 'error-extension'
    | 'error-storage';

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
        if (state.status === 'success' && state.data) {
            console.log('[ImportPage] Received recording, storing...');
            setStatus('storing');

            // Reconstruct Blobs from serialized data
            const screenBlob = new Blob(
                [new Uint8Array(state.data.screenData.buffer)],
                { type: state.data.screenData.type }
            );

            let cameraBlob: Blob | undefined;
            if (state.data.cameraData) {
                cameraBlob = new Blob(
                    [new Uint8Array(state.data.cameraData.buffer)],
                    { type: state.data.cameraData.type }
                );
            }

            console.log('[ImportPage] Reconstructed blobs - screen:', screenBlob.size);

            importFromRawRecording(
                state.data.recording,
                screenBlob,
                cameraBlob
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
            case 'receiving': return 'Receiving recording from extension...';
            case 'storing': return 'Saving to your library...';
            case 'success': return 'Success! Opening editor...';
            case 'error-no-id': return 'No recording ID provided';
            case 'error-extension': return 'Failed to receive recording';
            case 'error-storage': return 'Failed to save recording';
        }
    };

    const isError = status.startsWith('error');

    return (
        <div className="min-h-screen bg-surface-base text-text-main flex flex-col items-center justify-center">
            <LogoLink />

            <div className="mt-8 text-center">
                <div className={`text-lg ${isError ? 'text-red-400' : 'text-text-main'}`}>
                    {getStatusMessage()}
                </div>

                {errorDetails && (
                    <div className="mt-2 text-sm text-text-muted">
                        {errorDetails}
                    </div>
                )}

                {!isError && status !== 'success' && (
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
