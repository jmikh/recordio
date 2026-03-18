
import type { ID, RawRecording } from '@shared/types';
import { captureException } from '../utils/sentry';

const DB_NAME = 'RecordioDB';
const DB_VERSION = 4;

export class ProjectStorage {
    private static dbPromise: Promise<IDBDatabase> | null = null;

    static async getDB(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // 1. Recordings Store (Blobs - raw video/audio/mic)
                if (!db.objectStoreNames.contains('recordings')) {
                    db.createObjectStore('recordings', { keyPath: 'id' });
                }

                // 2. Projects Store (RawRecording metadata)
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }

                // 3. Thumbnails Store (Blob storage for project previews)
                if (!db.objectStoreNames.contains('thumbnails')) {
                    db.createObjectStore('thumbnails', { keyPath: 'id' });
                }

                // 4. Custom Backgrounds Store (kept for DB version compat)
                if (!db.objectStoreNames.contains('customBackgrounds')) {
                    db.createObjectStore('customBackgrounds', { keyPath: 'id' });
                }

                // Remove legacy sources store if it exists
                if (db.objectStoreNames.contains('sources')) {
                    db.deleteObjectStore('sources');
                }
            };

            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onerror = (event) => {
                console.error('RecordioDB open failed:', event);
                captureException(new Error('RecordioDB open failed'));
                reject((event.target as IDBOpenDBRequest).error);
            };
        });

        return this.dbPromise;
    }

    // ===========================================
    // RECORDING (BLOB) HELPERS
    // ===========================================

    static async saveRecordingBlob(id: ID, blob: Blob): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');
            store.put({ id, blob });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    static async getRecordingBlob(id: ID): Promise<Blob | undefined> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readonly');
            const store = tx.objectStore('recordings');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result?.blob);
            req.onerror = () => reject(req.error);
        });
    }

    // ===========================================
    // RAW RECORDING (Extension-only)
    // ===========================================

    /**
     * Saves a RawRecording to the 'projects' store.
     * The extension saves recordings in this lightweight format
     * instead of creating a full Project.
     */
    static async saveRawRecording(recording: RawRecording): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            const store = tx.objectStore('projects');
            store.put(recording);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Loads a RawRecording by ID from the 'projects' store.
     */
    static async loadRawRecording(id: string): Promise<RawRecording | null> {
        const db = await this.getDB();
        const result = await new Promise<RawRecording | undefined>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return result || null;
    }

    /**
     * Deletes a RawRecording and its associated blobs.
     */
    static async deleteRawRecording(recordingId: string): Promise<void> {
        const db = await this.getDB();

        const tx = db.transaction(['projects', 'recordings'], 'readwrite');

        // 1. Delete the recording entry
        tx.objectStore('projects').delete(recordingId);

        // 2. Delete associated blobs (scan for recordingId in key)
        const recordingsStore = tx.objectStore('recordings');
        const recordingsReq = recordingsStore.openCursor();
        recordingsReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const key = cursor.key.toString();
                if (key.includes(recordingId)) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ===========================================
    // THUMBNAILS
    // ===========================================

    static async saveThumbnail(projectId: ID, blob: Blob): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('thumbnails', 'readwrite');
            const store = tx.objectStore('thumbnails');
            const req = store.put({ id: projectId, blob });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    static async getThumbnail(id: ID): Promise<Blob | undefined> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['thumbnails'], 'readonly');
            const store = tx.objectStore('thumbnails');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result?.blob);
            req.onerror = () => reject(req.error);
        });
    }
}
