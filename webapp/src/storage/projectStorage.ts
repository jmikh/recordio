
import type { ID, Project } from '../types';
import { EDITOR_ORIGIN_DEV, EDITOR_ORIGIN_PROD } from '@shared/types/bridge';

// Use different DB for website vs extension
// Website (localhost:3001 or app.recordio.cc) uses 'recordio-editor'
// Extension uses 'RecordioDB'
const isWebsite = typeof window !== 'undefined' &&
    (window.location.origin === EDITOR_ORIGIN_DEV ||
        window.location.origin === EDITOR_ORIGIN_PROD);

const DB_NAME = isWebsite ? 'recordio-editor' : 'RecordioDB';
const DB_VERSION = 5; // Added customMusic store

/**
 * Entry in the global custom backgrounds library.
 */
export interface CustomBackgroundEntry {
    id: string;        // bg-{uuid}
    blob: Blob;
    createdAt: number; // timestamp
}

/**
 * Entry in the global custom music library.
 */
export interface CustomMusicEntry {
    id: string;        // music-{uuid}
    blob: Blob;
    name: string;      // Original filename
    createdAt: number; // timestamp
}

export class ProjectStorage {
    private static dbPromise: Promise<IDBDatabase> | null = null;

    static async getDB(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // 1. Recordings Store (Blobs - project-specific)
                if (!db.objectStoreNames.contains('recordings')) {
                    db.createObjectStore('recordings', { keyPath: 'id' });
                }

                // 2. Projects Store (contains embedded sources and events)
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }

                // 3. Thumbnails Store (Blob storage for project previews)
                if (!db.objectStoreNames.contains('thumbnails')) {
                    db.createObjectStore('thumbnails', { keyPath: 'id' });
                }

                // 4. Custom Backgrounds Store (Global library)
                if (!db.objectStoreNames.contains('customBackgrounds')) {
                    db.createObjectStore('customBackgrounds', { keyPath: 'id' });
                }

                // 5. Custom Music Store (Global library)
                if (!db.objectStoreNames.contains('customMusic')) {
                    db.createObjectStore('customMusic', { keyPath: 'id' });
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
                reject((event.target as IDBOpenDBRequest).error);
            };
        });

        return this.dbPromise;
    }

    /**
     * Loads a project by ID.
     * Throws error if not found.
     */
    static async loadProjectOrFail(projectId: ID): Promise<Project> {
        const existingProject = await this.loadProject(projectId);
        if (existingProject) {
            console.log(`[ProjectStorage] Loaded existing project: ${projectId}`);
            return existingProject;
        }

        throw new Error(`Project ${projectId} not found.`);
    }

    /**
     * Saves the project to the 'projects' store.
     * Excludes transient runtimeUrl fields - only storageUrl is persisted.
     */
    static async saveProject(project: Project): Promise<void> {
        const db = await this.getDB();

        // Strip runtimeUrl from sources before saving (it's transient)
        const projectToSave = this.stripRuntimeUrls(project);

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            const store = tx.objectStore('projects');
            const req = store.put(projectToSave);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Strips transient runtimeUrl fields from sources and settings before persisting.
     */
    private static stripRuntimeUrls(project: Project): Project {
        const stripped = { ...project };

        // Strip runtimeUrl from screen source
        if (stripped.screenSource) {
            const { runtimeUrl: _r, ...screenRest } = stripped.screenSource;
            stripped.screenSource = screenRest as typeof stripped.screenSource;
        }

        // Strip runtimeUrl from camera source
        if (stripped.cameraSource) {
            const { runtimeUrl: _r, ...cameraRest } = stripped.cameraSource;
            stripped.cameraSource = cameraRest as typeof stripped.cameraSource;
        }

        // Strip customRuntimeUrl from background settings
        if (stripped.settings?.background?.customRuntimeUrl) {
            const { customRuntimeUrl: _r, ...bgRest } = stripped.settings.background;
            stripped.settings = {
                ...stripped.settings,
                background: bgRest as typeof stripped.settings.background
            };
        }

        // Strip customRuntimeUrl from audio music settings
        if (stripped.settings?.audio?.music?.customRuntimeUrl) {
            const { customRuntimeUrl: _r, ...musicRest } = stripped.settings.audio.music;
            stripped.settings = {
                ...stripped.settings,
                audio: {
                    ...stripped.settings.audio,
                    music: musicRest as typeof stripped.settings.audio.music
                }
            };
        }

        return stripped;
    }

    /**
     * Loads a project and re-hydrates it with necessary data.
     */
    static async loadProject(projectId: ID): Promise<Project | null> {
        const db = await this.getDB();

        const projectRaw = await new Promise<Project | undefined>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.get(projectId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!projectRaw) return null;

        // Re-hydrate embedded source runtimeUrls
        const project = { ...projectRaw };

        // Hydrate screen source runtimeUrl
        if (project.screenSource?.storageUrl?.startsWith('recordio-blob://')) {
            const blobId = project.screenSource.storageUrl.replace('recordio-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (blob) {
                project.screenSource = {
                    ...project.screenSource,
                    runtimeUrl: URL.createObjectURL(blob)
                };
            }
        }

        // Hydrate camera source runtimeUrl
        if (project.cameraSource?.storageUrl?.startsWith('recordio-blob://')) {
            const blobId = project.cameraSource.storageUrl.replace('recordio-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (blob) {
                project.cameraSource = {
                    ...project.cameraSource,
                    runtimeUrl: URL.createObjectURL(blob)
                };
            }
        }

        // Hydrate background customRuntimeUrl
        if (project.settings?.background?.customStorageUrl?.startsWith('recordio-blob://')) {
            const blobId = project.settings.background.customStorageUrl.replace('recordio-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (blob) {
                project.settings = {
                    ...project.settings,
                    background: {
                        ...project.settings.background,
                        customRuntimeUrl: URL.createObjectURL(blob)
                    }
                };

                // Auto-add to library if libraryId is set but not in library
                const libraryId = project.settings.background.customLibraryId;
                if (libraryId) {
                    const existsInLibrary = await this.getCustomBackground(libraryId);
                    if (!existsInLibrary) {
                        // Re-add to library with same ID
                        await this.saveCustomBackgroundWithId(libraryId, blob);
                        console.log(`[ProjectStorage] Auto-added missing background to library: ${libraryId}`);
                    }
                }
            }
        }

        // Hydrate audio music customRuntimeUrl
        if (project.settings?.audio?.music?.customStorageUrl?.startsWith('recordio-blob://')) {
            const blobId = project.settings.audio.music.customStorageUrl.replace('recordio-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (blob) {
                project.settings = {
                    ...project.settings,
                    audio: {
                        ...project.settings.audio,
                        music: {
                            ...project.settings.audio.music,
                            customRuntimeUrl: URL.createObjectURL(blob)
                        }
                    }
                };
            }
        }

        return project;
    }

    /**
     * Loads a project WITHOUT hydrating runtimeUrls.
     * Use this in service workers where URL.createObjectURL is not available.
     */
    static async loadProjectRaw(projectId: ID): Promise<Project | null> {
        const db = await this.getDB();

        const projectRaw = await new Promise<Project | undefined>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.get(projectId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        return projectRaw || null;
    }

    /**
     * Lists all projects in the DB.
     * Returns a lightweight array of projects.
     */
    static async listProjects(): Promise<Project[]> {
        const db = await this.getDB();
        const projects = await new Promise<Project[]>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as Project[]);
            req.onerror = () => reject(req.error);
        });

        // Hydrate Thumbnails
        for (const p of projects) {
            const thumbBlob = await this.getThumbnail(p.id);
            if (thumbBlob) {
                p.thumbnail = URL.createObjectURL(thumbBlob);
            }
        }

        return projects;
    }

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

    // ===========================================
    // RECORDING (BLOB) HELPER
    // ===========================================

    static async saveRecordingBlob(id: ID, blob: Blob): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');
            const req = store.put({ id, blob });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
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

    static async deleteProject(projectId: ID): Promise<void> {
        const db = await this.getDB();

        // Transaction across all stores
        const tx = db.transaction(['projects', 'recordings', 'thumbnails'], 'readwrite');

        // 1. Delete Project
        tx.objectStore('projects').delete(projectId);

        // 2. Delete Associated Recordings (scan for projectId in key)
        const recordingsStore = tx.objectStore('recordings');
        const recordingsReq = recordingsStore.openCursor();
        recordingsReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const key = cursor.key.toString();
                if (key.includes(projectId)) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };

        // 3. Delete Thumbnail
        tx.objectStore('thumbnails').delete(projectId);

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    static async deleteRecordingBlob(id: ID): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readwrite');
            const store = tx.objectStore('recordings');
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ===========================================
    // CUSTOM BACKGROUNDS LIBRARY (Global)
    // ===========================================

    /**
     * Save a background image to the global library.
     * Returns the generated ID.
     */
    static async saveCustomBackground(blob: Blob): Promise<string> {
        const db = await this.getDB();
        const id = `bg-${crypto.randomUUID()}`;
        const entry: CustomBackgroundEntry = {
            id,
            blob,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = db.transaction('customBackgrounds', 'readwrite');
            const store = tx.objectStore('customBackgrounds');
            const req = store.put(entry);
            req.onsuccess = () => resolve(id);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Save a background image with a specific ID (for restoring deleted entries).
     */
    static async saveCustomBackgroundWithId(id: string, blob: Blob): Promise<void> {
        const db = await this.getDB();
        const entry: CustomBackgroundEntry = {
            id,
            blob,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = db.transaction('customBackgrounds', 'readwrite');
            const store = tx.objectStore('customBackgrounds');
            const req = store.put(entry);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get all custom backgrounds from the library.
     * Sorted by createdAt descending (newest first).
     */
    static async listCustomBackgrounds(): Promise<CustomBackgroundEntry[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('customBackgrounds', 'readonly');
            const store = tx.objectStore('customBackgrounds');
            const req = store.getAll();
            req.onsuccess = () => {
                const entries = req.result as CustomBackgroundEntry[];
                // Sort by createdAt descending
                entries.sort((a, b) => b.createdAt - a.createdAt);
                resolve(entries);
            };
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get a specific custom background by ID.
     */
    static async getCustomBackground(id: string): Promise<Blob | undefined> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('customBackgrounds', 'readonly');
            const store = tx.objectStore('customBackgrounds');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result?.blob);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Delete a custom background from the library.
     */
    static async deleteCustomBackground(id: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('customBackgrounds', 'readwrite');
            const store = tx.objectStore('customBackgrounds');
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ===========================================
    // CUSTOM MUSIC LIBRARY (Global)
    // ===========================================

    /**
     * Save a music file to the global library.
     * Returns the generated ID.
     */
    static async saveCustomMusic(blob: Blob, name: string): Promise<string> {
        const db = await this.getDB();
        const id = `music-${crypto.randomUUID()}`;
        const entry: CustomMusicEntry = {
            id,
            blob,
            name,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = db.transaction('customMusic', 'readwrite');
            const store = tx.objectStore('customMusic');
            const req = store.put(entry);
            req.onsuccess = () => resolve(id);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Save a music file with a specific ID (for restoring deleted entries).
     */
    static async saveCustomMusicWithId(id: string, blob: Blob, name: string): Promise<void> {
        const db = await this.getDB();
        const entry: CustomMusicEntry = {
            id,
            blob,
            name,
            createdAt: Date.now()
        };

        return new Promise((resolve, reject) => {
            const tx = db.transaction('customMusic', 'readwrite');
            const store = tx.objectStore('customMusic');
            const req = store.put(entry);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get all custom music from the library.
     * Sorted by createdAt descending (newest first).
     */
    static async listCustomMusic(): Promise<CustomMusicEntry[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('customMusic', 'readonly');
            const store = tx.objectStore('customMusic');
            const req = store.getAll();
            req.onsuccess = () => {
                const entries = req.result as CustomMusicEntry[];
                entries.sort((a, b) => b.createdAt - a.createdAt);
                resolve(entries);
            };
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get a specific custom music entry by ID.
     */
    static async getCustomMusic(id: string): Promise<CustomMusicEntry | undefined> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('customMusic', 'readonly');
            const store = tx.objectStore('customMusic');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Delete a custom music entry from the library.
     */
    static async deleteCustomMusic(id: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('customMusic', 'readwrite');
            const store = tx.objectStore('customMusic');
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}

// ============================================
// Import from RawRecording (for handoff flow)
// ============================================

import type { ScreenMetadata, CameraMetadata, UserEvents } from '../types';
import { ProjectImpl } from '../core/Project';

interface RawRecording {
    id: string;
    name: string;
    timestamp: number;
    screenSource: ScreenMetadata;
    cameraSource?: CameraMetadata;
    userEvents: UserEvents;
}

export async function importFromRawRecording(
    recording: RawRecording,
    screenBlob: Blob,
    cameraBlob?: Blob
): Promise<Project> {
    const projectId = `proj-${recording.id}`;

    // 1. Save blobs
    const screenBlobId = `rec-${projectId}-screen`;
    await ProjectStorage.saveRecordingBlob(screenBlobId, screenBlob);

    let cameraBlobId: string | undefined;
    if (cameraBlob) {
        cameraBlobId = `rec-${projectId}-camera`;
        await ProjectStorage.saveRecordingBlob(cameraBlobId, cameraBlob);
    }

    // 2. Build source metadata with new storage URLs
    const screenSource: ScreenMetadata = {
        ...recording.screenSource,
        id: `src-${projectId}-screen`,
        storageUrl: `recordio-blob://${screenBlobId}`,
    };

    let cameraSource: CameraMetadata | undefined;
    if (recording.cameraSource && cameraBlobId) {
        cameraSource = {
            ...recording.cameraSource,
            id: `src-${projectId}-camera`,
            storageUrl: `recordio-blob://${cameraBlobId}`,
        };
    }

    // 3. Create project with default settings
    const project = ProjectImpl.createFromSource(
        projectId,
        screenSource,
        recording.userEvents,
        cameraSource,
        recording.name
    );

    // 4. Save project
    await ProjectStorage.saveProject(project);

    console.log('[ProjectStorage] Imported recording as project:', projectId);
    return project;
}
