/**
 * useExtensionBridge Hook
 * 
 * Handles direct communication with the Chrome extension for recording handoff.
 */

import { useCallback, useState } from 'react';
import {
    BRIDGE_MSG,
    type HandoffRecordingPayload,
} from '../types/bridge';

const EXTENSION_ID = 'lpponocoanighhephabalkejmdbjlhmi';

export interface HandoffState {
    status: 'idle' | 'detecting' | 'requesting' | 'success' | 'error';
    recordingId: string | null;
    error: string | null;
    data: HandoffRecordingPayload | null;
}

/**
 * Send a message to the Chrome extension using externally_connectable.
 * 
 * When a website communicates with an extension, Chrome injects chrome.runtime
 * but the sendMessage API uses callbacks, not promises.
 */
function sendToExtension<T>(
    extensionId: string,
    message: unknown
): Promise<T> {
    return new Promise((resolve, reject) => {
        // Chrome injects chrome.runtime for websites in externally_connectable
        const chrome = (window as unknown as { chrome?: typeof globalThis.chrome }).chrome;

        // Debug: Log what's available
        console.log('[sendToExtension] window.chrome:', typeof chrome);
        console.log('[sendToExtension] chrome.runtime:', chrome?.runtime);
        console.log('[sendToExtension] chrome.runtime?.sendMessage:', typeof chrome?.runtime?.sendMessage);

        if (!chrome?.runtime?.sendMessage) {
            reject(new Error(
                'Chrome runtime not available. ' +
                'Make sure: (1) You are in Chrome, (2) Extension is installed and enabled, ' +
                '(3) Extension manifest has externally_connectable with this origin, ' +
                '(4) Extension was reloaded after manifest change. ' +
                `Current origin: ${window.location.origin}`
            ));
            return;
        }

        try {
            // externally_connectable uses callback-based API from websites
            chrome.runtime.sendMessage(extensionId, message, (response) => {
                // Check for Chrome runtime errors
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || 'Extension communication failed'));
                    return;
                }

                if (response === undefined) {
                    reject(new Error('No response from extension'));
                    return;
                }

                resolve(response as T);
            });
        } catch (error) {
            reject(error);
        }
    });
}

export function useExtensionBridge() {
    const [state, setState] = useState<HandoffState>({
        status: 'idle',
        recordingId: null,
        error: null,
        data: null,
    });

    const requestHandoff = useCallback(async (recordingId: string) => {
        console.log('[useExtensionBridge] Requesting handoff for:', recordingId);

        setState({
            status: 'detecting',
            recordingId,
            error: null,
            data: null,
        });

        try {
            setState(prev => ({ ...prev, status: 'requesting' }));

            const response = await sendToExtension<{
                type: string;
                payload: HandoffRecordingPayload | { error: string };
            }>(EXTENSION_ID, {
                type: BRIDGE_MSG.BRIDGE_READY,
                payload: { recordingId },
            });

            console.log('[useExtensionBridge] Response from extension:', response);

            if (response.type === BRIDGE_MSG.HANDOFF_RECORDING) {
                setState(prev => ({
                    ...prev,
                    status: 'success',
                    data: response.payload as HandoffRecordingPayload,
                }));
            } else if (response.type === BRIDGE_MSG.HANDOFF_ERROR) {
                setState(prev => ({
                    ...prev,
                    status: 'error',
                    error: (response.payload as { error: string }).error,
                }));
            } else {
                setState(prev => ({
                    ...prev,
                    status: 'error',
                    error: 'Unexpected response from extension',
                }));
            }
        } catch (error) {
            console.error('[useExtensionBridge] Error:', error);
            setState(prev => ({
                ...prev,
                status: 'error',
                error: error instanceof Error ? error.message : 'Failed to communicate with extension',
            }));
        }
    }, []);

    const confirmHandoff = useCallback(async (projectId: string) => {
        if (!state.recordingId) return;

        try {
            await sendToExtension(EXTENSION_ID, {
                type: BRIDGE_MSG.HANDOFF_COMPLETE,
                payload: {
                    recordingId: state.recordingId,
                    projectId,
                },
            });
            console.log('[useExtensionBridge] Handoff confirmed');
        } catch (error) {
            console.error('[useExtensionBridge] Error confirming handoff:', error);
        }
    }, [state.recordingId]);

    return { state, requestHandoff, confirmHandoff };
}
