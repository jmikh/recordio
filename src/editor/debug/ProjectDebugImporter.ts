/**
 * ProjectDebugImporter
 * 
 * Imports a project from a debug zip file into the local IndexedDB.
 * Preserves original IDs for exact reproduction of issues.
 */

import JSZip from 'jszip';
import type { Project, SourceMetadata } from '../../core/types';
import { ProjectStorage } from '../../storage/projectStorage';

interface ExportManifest {
    version: number;
    exportedAt: string;
    projectId: string;
    projectName: string;
}

export class ProjectDebugImporter {
    /**
     * Imports a project from a zip file.
     * Returns the imported project ID on success.
     */
    static async importProject(file: File): Promise<string> {
        const zip = await JSZip.loadAsync(file);

        // 1. Read and validate manifest
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) {
            throw new Error('Invalid debug export: missing manifest.json');
        }
        const manifestText = await manifestFile.async('text');
        const manifest: ExportManifest = JSON.parse(manifestText);

        if (manifest.version !== 1) {
            throw new Error(`Unsupported export version: ${manifest.version}`);
        }

        console.log(`[DebugImporter] Importing project: ${manifest.projectName} (${manifest.projectId})`);

        // 2. Import recordings first (blobs)
        const recordingsFolder = zip.folder('recordings');
        if (recordingsFolder) {
            const recordingFiles = Object.keys(zip.files).filter(path =>
                path.startsWith('recordings/') && path.endsWith('.blob')
            );

            for (const path of recordingFiles) {
                const blobId = path.replace('recordings/', '').replace('.blob', '');
                const fileEntry = zip.file(path);
                if (fileEntry) {
                    const arrayBuffer = await fileEntry.async('arraybuffer');
                    const blob = new Blob([arrayBuffer]);
                    await ProjectStorage.saveRecordingBlob(blobId, blob);
                    console.log(`[DebugImporter] Imported recording: ${blobId}`);
                }
            }
        }

        // 3. Import events (JSON blobs stored as recordings)
        const eventsFolder = zip.folder('events');
        if (eventsFolder) {
            const eventFiles = Object.keys(zip.files).filter(path =>
                path.startsWith('events/') && path.endsWith('.json')
            );

            for (const path of eventFiles) {
                const eventsBlobId = path.replace('events/', '').replace('.json', '');
                const fileEntry = zip.file(path);
                if (fileEntry) {
                    const text = await fileEntry.async('text');
                    const blob = new Blob([text], { type: 'application/json' });
                    await ProjectStorage.saveRecordingBlob(eventsBlobId, blob);
                    console.log(`[DebugImporter] Imported events: ${eventsBlobId}`);
                }
            }
        }

        // 4. Import sources
        const sourcesFolder = zip.folder('sources');
        if (sourcesFolder) {
            const sourceFiles = Object.keys(zip.files).filter(path =>
                path.startsWith('sources/') && path.endsWith('.json')
            );

            for (const path of sourceFiles) {
                const fileEntry = zip.file(path);
                if (fileEntry) {
                    const text = await fileEntry.async('text');
                    const source: SourceMetadata = JSON.parse(text);
                    await ProjectStorage.saveSource(source);
                    console.log(`[DebugImporter] Imported source: ${source.id}`);
                }
            }
        }

        // 5. Import project
        const projectFile = zip.file('project.json');
        if (!projectFile) {
            throw new Error('Invalid debug export: missing project.json');
        }
        const projectText = await projectFile.async('text');
        const project: Project = JSON.parse(projectText, (key, value) => {
            // Convert ISO date strings back to Date objects
            if (key === 'createdAt' || key === 'updatedAt' || key === 'generatedAt') {
                return new Date(value);
            }
            return value;
        });

        await ProjectStorage.saveProject(project);
        console.log(`[DebugImporter] Imported project: ${project.id}`);

        // 6. Import thumbnail
        const thumbnailFile = zip.file('thumbnail.png');
        if (thumbnailFile) {
            const arrayBuffer = await thumbnailFile.async('arraybuffer');
            const blob = new Blob([arrayBuffer], { type: 'image/png' });
            await ProjectStorage.saveThumbnail(project.id, blob);
            console.log(`[DebugImporter] Imported thumbnail`);
        }

        return project.id;
    }

    /**
     * Opens a file picker and imports the selected zip file.
     * Returns the imported project ID, or null if cancelled.
     */
    static async importFromFilePicker(): Promise<string | null> {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.zip';

            input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }

                try {
                    const projectId = await this.importProject(file);
                    resolve(projectId);
                } catch (error) {
                    console.error('[DebugImporter] Import failed:', error);
                    alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    resolve(null);
                }
            };

            input.oncancel = () => resolve(null);
            input.click();
        });
    }
}
