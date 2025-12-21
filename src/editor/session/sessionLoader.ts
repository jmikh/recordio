import type { UserEvent } from '../../core/types';

export interface SessionData {
    videoUrl: string | null;
    cameraUrl: string | null;
    metadata: UserEvent[];
    recordingStartTime?: number;
}

export async function loadSessionData(): Promise<SessionData> {
    const result: SessionData = {
        videoUrl: null,
        cameraUrl: null,
        metadata: []
    };

    // 1. Load Metadata from Chrome Storage
    try {
        const storage = await chrome.storage.local.get(['recordingMetadata']);
        if (storage.recordingMetadata) {
            result.metadata = storage.recordingMetadata as UserEvent[];
        }
    } catch (e) {
        console.warn('Failed to load metadata from chrome storage:', e);
    }

    // 2. Load Blobs from IndexedDB
    try {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('RecordoDB', 1);
            request.onerror = () => reject('IDB Open Failed');
            request.onsuccess = (event: any) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('recordings')) {
                    resolve();
                    return;
                }
                const transaction = db.transaction(['recordings'], 'readonly');
                const store = transaction.objectStore('recordings');

                // Get Screen
                const getScreen = store.get('latest');

                getScreen.onsuccess = () => {
                    const blobData = getScreen.result;
                    if (blobData) {
                        result.videoUrl = URL.createObjectURL(blobData.blob);
                        if (blobData.startTime) result.recordingStartTime = blobData.startTime;
                        else if (blobData.timestamp) result.recordingStartTime = blobData.timestamp;
                    }

                    // Get Camera
                    const getCamera = store.get('latest-camera');
                    getCamera.onsuccess = () => {
                        const camData = getCamera.result;
                        if (camData) {
                            result.cameraUrl = URL.createObjectURL(camData.blob);
                        }
                        resolve();
                    };
                    getCamera.onerror = () => {
                        // No camera or error, just resolve
                        resolve();
                    };
                };

                getScreen.onerror = () => reject('IDB Get Screen Failed');
            };
        });
    } catch (e) {
        console.warn('Failed to load video from IndexedDB:', e);
    }

    return result;
}
