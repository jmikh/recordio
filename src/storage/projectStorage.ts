
import type { ID, Project, SourceMetadata } from '../core/types';
import { ProjectImpl } from '../core/Project';


const DB_NAME = 'RecordoDB';
const DB_VERSION = 2; // Incremented for schema change (thumbnails store)

export class ProjectStorage {
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

                // 4. Thumbnails Store (Blob storage for project previews)
                if (!db.objectStoreNames.contains('thumbnails')) {
                    db.createObjectStore('thumbnails', { keyPath: 'id' });
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
     * Loads a project by ID.
     * Throws error if not found.
     */
    static async loadProjectOrFail(projectId: ID): Promise<Project> {
        // 1. Try to load existing project
        const existingProject = await this.loadProject(projectId);
        if (existingProject) {
            console.log(`[ProjectStorage] Loaded existing project: ${projectId}`);
            return existingProject;
        }

        throw new Error(`Project ${projectId} not found.`);
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
        return projectRaw;
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
        // We load generic thumbnail URLs if present
        for (const p of projects) {
            // Check if thumbnail blob exists
            // We do this sequentially here but could be parallelized for performance if needed
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
            const tx = db.transaction(['thumbnails'], 'readonly'); // Ensure store name is correct
            // Note: If store doesn't exist (old DB version), transaction will fail.
            // But getDB() handles upgrade.
            const store = tx.objectStore('thumbnails');
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result?.blob);
            req.onerror = () => reject(req.error);
        });
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

        // Transaction across all stores involved
        const tx = db.transaction(['projects', 'sources', 'recordings', 'thumbnails'], 'readwrite');

        // 1. Delete Project
        tx.objectStore('projects').delete(projectId);

        // 2. Delete Associated Sources & Recordings
        const sourceIds = ProjectImpl.getReferencedSourceIds(project);
        for (const sourceId of sourceIds) {
            tx.objectStore('sources').delete(sourceId);

            // If sourceId looks like `src-...`, the blob is `rec-...`
            if (sourceId.startsWith('src-')) {
                const blobId = sourceId.replace('src-', 'rec-');
                tx.objectStore('recordings').delete(blobId);
            }
        }

        // 3. Delete Thumbnail
        tx.objectStore('thumbnails').delete(projectId);

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }


}
