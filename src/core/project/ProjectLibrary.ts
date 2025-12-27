
import type { ID, Project, SourceMetadata } from '../types';
import { ProjectImpl } from './Project';

const DB_NAME = 'RecordoDB';
const DB_VERSION = 1;

export class ProjectLibrary {
    private static dbPromise: Promise<IDBDatabase> | null = null;

    static async getDB(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // 1. Recordings Store (Blobs) - Existing or New
                if (!db.objectStoreNames.contains('recordings')) {
                    db.createObjectStore('recordings', { keyPath: 'id' });
                }

                // 2. Sources Store (Heavy Immutable Data)
                if (!db.objectStoreNames.contains('sources')) {
                    db.createObjectStore('sources', { keyPath: 'id' });
                }

                // 3. Projects Store (Lightweight + Mutable Events)
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onerror = (event) => {
                console.error('RecordoDB open failed:', event);
                reject((event.target as IDBOpenDBRequest).error);
            };
        });

        return this.dbPromise;
    }

    /**
     * initializes a project for a given ID.
     * 1. Checks if Project exists. If yes, loads it.
     * 2. If no, checks if Source exists (from recording). If yes, creates new Project.
     * 3. Else throws error.
     */
    static async initProject(projectId: ID): Promise<Project> {
        // 1. Try to load existing project
        const existingProject = await this.loadProject(projectId);
        if (existingProject) {
            console.log(`[ProjectLibrary] Loaded existing project: ${projectId}`);
            return existingProject;
        }

        // 2. Try to load sources (implying a new recording just finished)
        // We look for both screen and camera sources based on convention
        const screenSourceId = `src-${projectId}-screen`;
        const cameraSourceId = `src-${projectId}-camera`;

        const screenSource = await this.loadSource(screenSourceId);
        const cameraSource = await this.loadSource(cameraSourceId);



        if (screenSource) {
            console.log(`[ProjectLibrary] Found screen source for project ${projectId}.`);

            // Fetch initial events for ViewportMotion calculation
            let screenEvents: any = { mouseClicks: [], keyboardEvents: [], mousePositions: [], drags: [] };
            if (screenSource.eventsUrl) {
                try {
                    screenEvents = await this.loadEvents(screenSource.eventsUrl);
                } catch (e) {
                    console.error("Failed to load initial events for project creation", e);
                }
            }

            return ProjectImpl.createFromSource(projectId, screenSource, screenEvents, cameraSource);
        }

        throw new Error(`Project ${projectId} not found and no matching source found.`);
    }

    /**
     * Loads UserEvents from a URL, handling special 'recordo-blob://' protocol.
     */
    static async loadEvents(url: string): Promise<any> {
        if (url.startsWith('recordo-blob://')) {
            const blobId = url.replace('recordo-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (!blob) throw new Error(`Event blob not found: ${blobId}`);

            const text = await blob.text();
            return JSON.parse(text);
        } else {
            const resp = await fetch(url);
            return await resp.json();
        }
    }

    /**
     * Saves the project to the 'projects' store.
     */
    static async saveProject(project: Project): Promise<void> {
        const db = await this.getDB();

        // Project contains SourceMetadata which is already lightweight (no heavy events).
        // We can save directly.
        const projectToSave = project;

        return new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            const store = tx.objectStore('projects');
            const req = store.put(projectToSave);

            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
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

        // Re-hydrate sources? 
        const hydratedSources: Record<ID, SourceMetadata> = {};
        for (const [id, sourceStub] of Object.entries(projectRaw.sources)) {
            const fullSource = await this.loadSource(id);
            if (fullSource) {
                hydratedSources[id] = fullSource;
            } else {
                hydratedSources[id] = sourceStub; // Fallback
            }
        }

        return {
            ...projectRaw,
            sources: hydratedSources
        };
    }

    // ===========================================
    // SOURCE HELPER
    // ===========================================

    static async saveSource(source: SourceMetadata): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sources', 'readwrite');
            const store = tx.objectStore('sources');
            const req = store.put(source);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    static async loadSource(sourceId: ID): Promise<SourceMetadata | undefined> {
        const db = await this.getDB();
        const source = await new Promise<SourceMetadata | undefined>((resolve, reject) => {
            const tx = db.transaction('sources', 'readonly');
            const store = tx.objectStore('sources');
            const req = store.get(sourceId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (source && source.url && source.url.startsWith('recordo-blob://')) {
            const blobId = source.url.replace('recordo-blob://', '');
            const blob = await this.getRecordingBlob(blobId);
            if (blob) {
                // Hydrate URL for playback
                source.url = URL.createObjectURL(blob);
            }
        }
        return source;
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
        // Find project to see what sources/recordings it has
        const project = await this.loadProject(projectId);
        if (!project) return;

        const db = await this.getDB();
        const tx = db.transaction(['projects', 'sources', 'recordings'], 'readwrite');

        // 1. Delete Project
        tx.objectStore('projects').delete(projectId);

        // 2. Delete Associated Sources & Recordings
        // For V1, we iterate the sources in the project and delete them
        for (const sourceId of Object.keys(project.sources)) {
            tx.objectStore('sources').delete(sourceId);

            // Assuming recording blob ID convention or we need to look it up
            // In recorder.ts, we save blob with key `rec-{projectId}-screen`
            // But we might have used different IDs.
            // A Source URL might point to it? "blob:..." is ephemeral.
            // We should ideally store the Blob ID in the Source or Recording metadata.
            // For V1, let's reconstruct the probable ID or delete broadly known keys

            // Current convention plan:
            // Source ID: `src-{projectId}-screen`
            // Blob ID: `rec-{projectId}-screen`

            // If sourceId looks like `src-...`, the blob is `rec-...`
            if (sourceId.startsWith('src-')) {
                const blobId = sourceId.replace('src-', 'rec-');
                tx.objectStore('recordings').delete(blobId);
            }
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }


}
