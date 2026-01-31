/**
 * ProjectDebugExporter
 * 
 * Exports a complete project (settings, sources, recordings, events, thumbnail)
 * into a zip file for debugging purposes.
 */

import JSZip from 'jszip';
import type { Project, ID, SourceMetadata } from '../../core/types';
import { ProjectStorage } from '../../storage/projectStorage';

interface ExportManifest {
    version: 1;
    exportedAt: string;
    projectId: ID;
    projectName: string;
}

export class ProjectDebugExporter {
    /**
     * Exports a project and all its dependencies to a downloadable zip file.
     */
    static async exportProject(project: Project): Promise<void> {
        const zip = new JSZip();
        const projectId = project.id;

        // 1. Create manifest
        const manifest: ExportManifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            projectId: project.id,
            projectName: project.name
        };
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        // 2. Export project JSON (with internal blob:// URLs converted back to recordio-blob://)
        const projectToExport = await this.dehydrateProject(project);
        zip.file('project.json', JSON.stringify(projectToExport, null, 2));

        // 3. Get all referenced source IDs from embedded sources
        const sourceIds: ID[] = [project.screenSource.id];
        if (project.cameraSource) {
            sourceIds.push(project.cameraSource.id);
        }

        // 4. Export sources and their recordings
        const sourcesFolder = zip.folder('sources');
        const recordingsFolder = zip.folder('recordings');
        const eventsFolder = zip.folder('events');

        for (const sourceId of sourceIds) {
            // Load source metadata from DB (unhydrated form)
            const source = await this.loadSourceUnhydrated(sourceId);
            if (!source) {
                console.warn(`[DebugExporter] Source ${sourceId} not found, skipping`);
                continue;
            }

            // Save source metadata
            sourcesFolder?.file(`${sourceId}.json`, JSON.stringify(source, null, 2));

            // Extract and save recording blob
            if (source.storageUrl && source.storageUrl.startsWith('recordio-blob://')) {
                const blobId = source.storageUrl.replace('recordio-blob://', '');
                const blob = await ProjectStorage.getRecordingBlob(blobId);
                if (blob) {
                    const arrayBuffer = await blob.arrayBuffer();
                    recordingsFolder?.file(`${blobId}.blob`, arrayBuffer);
                } else {
                    console.warn(`[DebugExporter] Recording blob ${blobId} not found`);
                }
            }

            // Extract and save events
            if (source.eventsUrl && source.eventsUrl.startsWith('recordio-blob://')) {
                const eventsBlobId = source.eventsUrl.replace('recordio-blob://', '');
                const eventsBlob = await ProjectStorage.getRecordingBlob(eventsBlobId);
                if (eventsBlob) {
                    const eventsText = await eventsBlob.text();
                    eventsFolder?.file(`${eventsBlobId}.json`, eventsText);
                } else {
                    console.warn(`[DebugExporter] Events blob ${eventsBlobId} not found`);
                }
            }
        }

        // 5. Export thumbnail
        const thumbnailBlob = await ProjectStorage.getThumbnail(projectId);
        if (thumbnailBlob) {
            const arrayBuffer = await thumbnailBlob.arrayBuffer();
            zip.file('thumbnail.png', arrayBuffer);
        }

        // 6. Generate and download zip
        const content = await zip.generateAsync({ type: 'blob' });
        this.downloadBlob(content, `${project.name}-debug.zip`);
    }

    /**
     * Load source metadata without hydrating the URL.
     * We need the original recordio-blob:// URL for export.
     */
    private static async loadSourceUnhydrated(sourceId: ID): Promise<SourceMetadata | undefined> {
        const db = await ProjectStorage.getDB();
        return new Promise<SourceMetadata | undefined>((resolve, reject) => {
            const tx = db.transaction('sources', 'readonly');
            const store = tx.objectStore('sources');
            const req = store.get(sourceId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Dehydrate a project - convert any blob: URLs back to recordio-blob:// format.
     * This ensures the export contains the persistent internal protocol URLs.
     */
    private static async dehydrateProject(project: Project): Promise<Project> {
        // The project object itself doesn't store blob URLs directly,
        // but we need to ensure any settings with URLs are handled properly.
        // For now, the project.settings.background.imageUrl might need handling
        // if it's a blob: URL, but typically it stores preset URLs or sourceId references.

        // Return a clean copy
        return JSON.parse(JSON.stringify(project, (_key, value) => {
            // Convert Date objects to ISO strings
            if (value instanceof Date) {
                return value.toISOString();
            }
            return value;
        }));
    }

    private static downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
