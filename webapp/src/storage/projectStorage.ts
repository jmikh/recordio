
import type { ID, Project } from '../types';
import { EDITOR_ORIGIN_DEV, EDITOR_ORIGIN_PROD } from '@shared/types/bridge';
import { migrateProject } from '../core/migrateProject';

// Use different DB for website vs extension
// Website (localhost:3001 or app.recordio.cc) uses 'recordio-editor'
// Extension uses 'RecordioDB'
const isWebsite = typeof window !== 'undefined' &&
    (window.location.origin === EDITOR_ORIGIN_DEV ||
        window.location.origin === EDITOR_ORIGIN_PROD);

const DB_NAME = isWebsite ? 'recordio-editor' : 'RecordioDB';
const DB_VERSION = 6; // Added syncMeta store for cloud sync

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

/**
 * Sync metadata for a project — tracks cloud sync state per project.
 * Stored in the `syncMeta` IndexedDB store, keyed by local project ID.
 */
export interface SyncMeta {
    /** Local project ID (key) — same ID used in cloud */
    projectId: string;
    /** User ID that owns this cloud project */
    userId: string;
    /** Last known cloud version (for optimistic concurrency) */
    cloudVersion: number;
    /** Upload status: 'pending' | 'ready' */
    uploadStatus: 'pending' | 'ready';
    /** Last time this project was synced to cloud */
    lastSyncedAt: number; // timestamp
    /** Last time this project was opened locally */
    lastAccessedAt?: number; // timestamp
    /** SHA-256 hash of the last uploaded thumbnail blob (skip re-upload if unchanged) */
    thumbnailHash?: string;
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

                // 6. Sync Metadata Store (cloud sync tracking)
                if (!db.objectStoreNames.contains('syncMeta')) {
                    db.createObjectStore('syncMeta', { keyPath: 'projectId' });
                }

                // Remove legacy sources store if it exists
                if (db.objectStoreNames.contains('sources')) {
                    db.deleteObjectStore('sources');
                }
            };

            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onblocked = () => {
                console.warn('[RecordioDB] Upgrade blocked — close other tabs and refresh');
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

            return existingProject;
        }

        throw new Error(`Project ${projectId} not found.`);
    }

    /**
     * Saves the project to the 'projects' store.
     * Excludes transient runtimeUrl fields - only storageUrl is persisted.
     *
     * ⚠️  The runtime project store strips `userEvents` from the project for
     * undo/redo performance (see `useProjectStore.loadProject`). Callers must
     * re-attach `userEvents` before calling this method, e.g.:
     *   `{ ...project, userEvents: store.userEvents }`
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

        // Strip runtimeUrl from microphone source
        if (stripped.microphoneSource) {
            const { runtimeUrl: _r, ...micRest } = stripped.microphoneSource;
            stripped.microphoneSource = micRest as typeof stripped.microphoneSource;
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

        let projectRaw = await new Promise<Project | undefined>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.get(projectId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        // If not found, check for legacy "proj-" prefixed version and migrate
        if (!projectRaw && !projectId.startsWith('proj-')) {
            const legacyId = `proj-${projectId}`;
            const legacyRaw = await new Promise<Project | undefined>((resolve, reject) => {
                const tx = db.transaction('projects', 'readonly');
                const store = tx.objectStore('projects');
                const req = store.get(legacyId);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (legacyRaw) {
                await this.migrateProjectPrefix(legacyId);
                // Re-read after migration
                projectRaw = await new Promise<Project | undefined>((resolve, reject) => {
                    const tx = db.transaction('projects', 'readonly');
                    const store = tx.objectStore('projects');
                    const req = store.get(projectId);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            }
        }

        if (!projectRaw) return null;

        // Re-hydrate embedded source runtimeUrls
        // Migrate schema before hydration
        const project = { ...migrateProject(projectRaw) };

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

        // Hydrate microphone source runtimeUrl
        if (project.microphoneSource?.storageUrl?.startsWith('recordio-blob://')) {
            const blobId = project.microphoneSource.storageUrl.replace('recordio-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (blob) {
                project.microphoneSource = {
                    ...project.microphoneSource,
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

        return projectRaw ? migrateProject(projectRaw) : null;
    }

    /**
     * Lists all projects in the DB.
     * Returns a lightweight array of projects.
     */
    static async listProjects(): Promise<Project[]> {
        const db = await this.getDB();
        let projects = await new Promise<Project[]>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as Project[]);
            req.onerror = () => reject(req.error);
        });

        // Migrate any legacy "proj-" prefixed projects before hydration
        const prefixed = projects.filter((p) => p.id.startsWith('proj-'));
        if (prefixed.length > 0) {
            for (const p of prefixed) {
                await this.migrateProjectPrefix(p.id);
            }
            // Re-read after migration
            projects = await new Promise<Project[]>((resolve, reject) => {
                const tx = db.transaction('projects', 'readonly');
                const store = tx.objectStore('projects');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result as Project[]);
                req.onerror = () => reject(req.error);
            });
        }

        // Hydrate Thumbnails
        for (const p of projects) {
            const thumbBlob = await this.getThumbnail(p.id);
            if (thumbBlob) {
                p.thumbnail = URL.createObjectURL(thumbBlob);
            } else {
                p.thumbnail = undefined;
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
        const tx = db.transaction(['projects', 'recordings', 'thumbnails', 'syncMeta'], 'readwrite');

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

        // 4. Delete Sync Metadata
        tx.objectStore('syncMeta').delete(projectId);

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

    /**
     * Renames a project without full hydration.
     * Reads raw, updates name + updatedAt, writes back.
     */
    static async renameProject(projectId: ID, newName: string): Promise<void> {
        const db = await this.getDB();
        const project = await new Promise<Project | undefined>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const req = store.get(projectId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (!project) throw new Error(`Project ${projectId} not found`);

        project.name = newName;
        project.updatedAt = new Date();

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            const store = tx.objectStore('projects');
            const req = store.put(project);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ===========================================
    // SYNC METADATA
    // ===========================================

    static async getSyncMeta(projectId: ID): Promise<SyncMeta | undefined> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('syncMeta', 'readonly');
            const store = tx.objectStore('syncMeta');
            const req = store.get(projectId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    static async saveSyncMeta(meta: SyncMeta): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('syncMeta', 'readwrite');
            const store = tx.objectStore('syncMeta');
            const req = store.put(meta);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    static async touchSyncMetaAccess(projectId: ID): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('syncMeta', 'readwrite');
            const store = tx.objectStore('syncMeta');
            const getReq = store.get(projectId);
            getReq.onsuccess = () => {
                const existing = getReq.result as SyncMeta | undefined;
                if (!existing) { resolve(); return; }
                existing.lastAccessedAt = Date.now();
                const putReq = store.put(existing);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }

    static async deleteSyncMeta(projectId: ID): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('syncMeta', 'readwrite');
            const store = tx.objectStore('syncMeta');
            const req = store.delete(projectId);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    static async listSyncMeta(): Promise<SyncMeta[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('syncMeta', 'readonly');
            const store = tx.objectStore('syncMeta');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as SyncMeta[]);
            req.onerror = () => reject(req.error);
        });
    }

    // ===========================================
    // BLOB EXISTENCE CHECK
    // ===========================================

    /**
     * Check if a recording blob exists without loading it into memory.
     */
    static async hasRecordingBlob(id: ID): Promise<boolean> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recordings', 'readonly');
            const store = tx.objectStore('recordings');
            const req = store.count(id);
            req.onsuccess = () => resolve(req.result > 0);
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

    /**
     * Estimate total IndexedDB usage in bytes by iterating all stores.
     * Sums Blob sizes for binary entries, and rough JSON size for metadata.
     */
    static async estimateIndexedDBUsage(): Promise<number> {
        const db = await this.getDB();
        const storeNames = Array.from(db.objectStoreNames);
        let totalBytes = 0;

        const tx = db.transaction(storeNames, 'readonly');

        const storePromises = storeNames.map(name => {
            return new Promise<number>((resolve, reject) => {
                const store = tx.objectStore(name);
                const req = store.openCursor();
                let storeBytes = 0;

                req.onsuccess = (e) => {
                    const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
                    if (cursor) {
                        const val = cursor.value;
                        if (val?.blob instanceof Blob) {
                            storeBytes += val.blob.size;
                        } else {
                            // Rough estimate for metadata entries
                            try { storeBytes += JSON.stringify(val).length * 2; } catch { /* skip */ }
                        }
                        cursor.continue();
                    } else {
                        resolve(storeBytes);
                    }
                };
                req.onerror = () => reject(req.error);
            });
        });

        const results = await Promise.all(storePromises);
        totalBytes = results.reduce((sum, n) => sum + n, 0);
        return totalBytes;
    }

    /**
     * Migrates a single project that has a "proj-" prefixed ID.
     * Re-keys the project, recordings, thumbnails, and syncMeta in one transaction,
     * and updates internal IDs (source IDs, storageUrls) within the project.
     * No-op if the ID doesn't start with "proj-".
     */
    static async migrateProjectPrefix(oldProjectId: string): Promise<string> {
        if (!oldProjectId.startsWith('proj-')) return oldProjectId;

        const newId = oldProjectId.slice(5); // strip "proj-"
        const db = await this.getDB();

        const project = await new Promise<any>((resolve, reject) => {
            const tx = db.transaction('projects', 'readonly');
            const req = tx.objectStore('projects').get(oldProjectId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (!project) return newId; // already migrated or doesn't exist

        // --- Update IDs within the project object ---
        project.id = newId;

        const rewriteId = (id: string | undefined) =>
            id?.replace(oldProjectId, newId);
        const rewriteUrl = (url: string | undefined) =>
            url?.replace(`rec-${oldProjectId}`, newId).replace(oldProjectId, newId);

        if (project.screenSource) {
            project.screenSource.id = rewriteId(project.screenSource.id);
            project.screenSource.storageUrl = rewriteUrl(project.screenSource.storageUrl);
        }
        if (project.cameraSource) {
            project.cameraSource.id = rewriteId(project.cameraSource.id);
            project.cameraSource.storageUrl = rewriteUrl(project.cameraSource.storageUrl);
        }
        if (project.microphoneSource) {
            project.microphoneSource.id = rewriteId(project.microphoneSource.id);
            project.microphoneSource.storageUrl = rewriteUrl(project.microphoneSource.storageUrl);
        }
        if (project.settings?.background?.customStorageUrl) {
            project.settings.background.customStorageUrl =
                rewriteUrl(project.settings.background.customStorageUrl);
        }
        if (project.settings?.audio?.music?.customStorageUrl) {
            project.settings.audio.music.customStorageUrl =
                rewriteUrl(project.settings.audio.music.customStorageUrl);
        }

        // --- Single transaction to re-key everything ---
        const tx = db.transaction(['projects', 'recordings', 'thumbnails', 'syncMeta'], 'readwrite');

        // Re-key project
        tx.objectStore('projects').delete(oldProjectId);
        tx.objectStore('projects').put(project);

        // Re-key thumbnail
        const thumbStore = tx.objectStore('thumbnails');
        const thumbReq = thumbStore.get(oldProjectId);
        thumbReq.onsuccess = () => {
            if (thumbReq.result) {
                thumbStore.delete(oldProjectId);
                thumbStore.put({ ...thumbReq.result, id: newId });
            }
        };

        // Re-key syncMeta
        const syncStore = tx.objectStore('syncMeta');
        const syncReq = syncStore.get(oldProjectId);
        syncReq.onsuccess = () => {
            if (syncReq.result) {
                syncStore.delete(oldProjectId);
                syncStore.put({ ...syncReq.result, projectId: newId });
            }
        };

        // Re-key recording blobs (strip "rec-" prefix and rename project ID segment)
        const recStore = tx.objectStore('recordings');
        const recCursor = recStore.openCursor();
        recCursor.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const key = cursor.key.toString();
                if (key.includes(oldProjectId)) {
                    const entry = cursor.value;
                    const newKey = key
                        .replace(`rec-${oldProjectId}`, newId)
                        .replace(oldProjectId, newId);
                    cursor.delete();
                    recStore.put({ ...entry, id: newKey });
                }
                cursor.continue();
            }
        };

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });

        console.log(`[ProjectStorage] Migrated project ${oldProjectId} → ${newId}`);
        return newId;
    }
}

// ============================================
// Import from RawRecording (for handoff flow)
// ============================================

import type { ScreenMetadata, CameraMetadata, MicrophoneMetadata, UserEvents } from '../types';
import { ProjectImpl } from '../core/Project';

interface RawRecording {
    id: string;
    name: string;
    timestamp: number;
    screenSource: ScreenMetadata;
    cameraSource?: CameraMetadata;
    microphoneSource?: MicrophoneMetadata;
    userEvents: UserEvents;
}

export async function importFromRawRecording(
    recording: RawRecording,
    screenBlob: Blob,
    cameraBlob?: Blob,
    micBlob?: Blob
): Promise<Project> {
    const projectId = recording.id;

    // 1. Save blobs
    const screenBlobId = `${projectId}-screen`;
    await ProjectStorage.saveRecordingBlob(screenBlobId, screenBlob);

    let cameraBlobId: string | undefined;
    if (cameraBlob) {
        cameraBlobId = `${projectId}-camera`;
        await ProjectStorage.saveRecordingBlob(cameraBlobId, cameraBlob);
    }

    let micBlobId: string | undefined;
    if (micBlob) {
        micBlobId = `${projectId}-mic`;
        await ProjectStorage.saveRecordingBlob(micBlobId, micBlob);
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

    let microphoneSource: MicrophoneMetadata | undefined;
    if (recording.microphoneSource && micBlobId) {
        microphoneSource = {
            ...recording.microphoneSource,
            id: `src-${projectId}-mic`,
            storageUrl: `recordio-blob://${micBlobId}`,
        };
    }

    // 3. Create project with default settings
    const project = ProjectImpl.createFromSource(
        projectId,
        screenSource,
        recording.userEvents,
        cameraSource,
        recording.name,
        microphoneSource
    );

    // 4. Save project
    await ProjectStorage.saveProject(project);


    return project;
}
