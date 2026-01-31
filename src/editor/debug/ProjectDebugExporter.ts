/**
 * ProjectDebugExporter
 * 
 * Exports a complete project (settings, sources, recordings, thumbnail)
 * into a zip file for debugging purposes.
 * 
 * Sources and events are now embedded directly in the Project object.
 */

import JSZip from 'jszip';
import type { Project, ID, SourceMetadata } from '../../core/types';
import { ProjectStorage } from '../../storage/projectStorage';

interface ExportManifest {
    version: 2;  // Bumped version for new embedded format
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
            version: 2,
            exportedAt: new Date().toISOString(),
            projectId: project.id,
            projectName: project.name
        };
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        // 2. Export project JSON (strip runtimeUrl, keep storageUrl)
        const projectToExport = this.prepareProjectForExport(project);
        zip.file('project.json', JSON.stringify(projectToExport, null, 2));

        // 3. Extract recordings from embedded sources
        const recordingsFolder = zip.folder('recordings');

        // Export screen recording
        await this.exportSourceRecording(project.screenSource, recordingsFolder);

        // Export camera recording (if present)
        if (project.cameraSource) {
            await this.exportSourceRecording(project.cameraSource, recordingsFolder);
        }

        // Export custom background (if present)
        if (project.settings.background.customStorageUrl?.startsWith('recordio-blob://')) {
            const blobId = project.settings.background.customStorageUrl.replace('recordio-blob://', '');
            const blob = await ProjectStorage.getRecordingBlob(blobId);
            if (blob) {
                const arrayBuffer = await blob.arrayBuffer();
                recordingsFolder?.file(`${blobId}.png`, arrayBuffer);
                console.log(`[DebugExporter] Exported custom background: ${blobId}`);
            }
        }

        // 4. Export thumbnail
        const thumbnailBlob = await ProjectStorage.getThumbnail(projectId);
        if (thumbnailBlob) {
            const arrayBuffer = await thumbnailBlob.arrayBuffer();
            zip.file('thumbnail.png', arrayBuffer);
        }

        // 5. Generate and download zip
        const content = await zip.generateAsync({ type: 'blob' });
        this.downloadBlob(content, `${project.name}-debug.zip`);
    }

    /**
     * Export a source's recording blob to the zip.
     */
    private static async exportSourceRecording(
        source: SourceMetadata,
        recordingsFolder: JSZip | null
    ): Promise<void> {
        if (!source.storageUrl?.startsWith('recordio-blob://')) {
            console.warn(`[DebugExporter] Source ${source.id} has no valid storageUrl`);
            return;
        }

        const blobId = source.storageUrl.replace('recordio-blob://', '');
        const blob = await ProjectStorage.getRecordingBlob(blobId);

        if (blob) {
            const arrayBuffer = await blob.arrayBuffer();
            recordingsFolder?.file(`${blobId}.webm`, arrayBuffer);
            console.log(`[DebugExporter] Exported recording: ${blobId}`);
        } else {
            console.warn(`[DebugExporter] Recording blob ${blobId} not found`);
        }
    }

    /**
     * Prepare project for export by stripping transient runtimeUrl fields.
     */
    private static prepareProjectForExport(project: Project): Project {
        // Create a clean copy, stripping runtime URLs and converting Dates
        return JSON.parse(JSON.stringify(project, (key, value) => {
            // Skip transient runtime URLs
            if (key === 'runtimeUrl' || key === 'customRuntimeUrl') {
                return undefined;
            }
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
