import JSZip from 'jszip';
import { LocalStorage } from './localStorage';
import { downloadViaNative } from '../bridge/macBridge';
import type { Project } from '../types';

/**
 * Blob manifest entry — stores MIME type so blobs are correctly typed on import.
 */
interface BlobManifest {
    [blobId: string]: { mimeType: string; size: number };
}

/**
 * Collects all recordio-blob:// IDs referenced by a project, with expected MIME types.
 */
function collectBlobEntries(project: Project): { id: string; mimeType: string }[] {
    const entries: { id: string; mimeType: string }[] = [];
    const extract = (url?: string, mimeType = 'application/octet-stream') => {
        if (url?.startsWith('recordio-blob://')) {
            entries.push({ id: url.replace('recordio-blob://', ''), mimeType });
        }
    };

    extract(project.screenSource?.storageUrl, 'video/mp4');
    extract(project.cameraSource?.storageUrl, 'video/mp4');
    extract(project.microphoneSource?.storageUrl, 'audio/wav');
    extract(project.settings?.background?.customStorageUrl, 'image/png');
    extract(project.settings?.audio?.music?.customStorageUrl, 'audio/mpeg');

    return entries;
}

/**
 * Exports a project and all its blobs to a downloadable .zip file.
 */
export async function exportProjectToZip(projectId: string): Promise<void> {
    const project = await LocalStorage.loadProjectRaw(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const zip = new JSZip();
    const blobEntries = collectBlobEntries(project);
    const manifest: BlobManifest = {};

    // Add each blob to the zip
    for (const { id: blobId, mimeType: expectedMimeType } of blobEntries) {
        const blob = await LocalStorage.getRecordingBlob(blobId);
        if (blob) {
            zip.file(`blobs/${blobId}.bin`, blob);
            // Use blob.type if available, otherwise fall back to expected MIME type
            manifest[blobId] = {
                mimeType: blob.type || expectedMimeType,
                size: blob.size,
            };
        }
    }

    // Add thumbnail if it exists
    const thumbnail = await LocalStorage.getThumbnail(projectId);
    if (thumbnail) {
        zip.file('thumbnail.bin', thumbnail);
    }

    // Add project JSON and manifest
    zip.file('project.json', JSON.stringify(project, null, 2));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // Generate and download
    const content = await zip.generateAsync({ type: 'blob' });
    const name = (project.name || 'project').replace(/[^a-zA-Z0-9-_ ]/g, '');
    const filename = `${name}.recordio.zip`;

    // Try native download first (WKWebView), fall back to <a> click (Chrome/Safari)
    const sentToNative = await downloadViaNative(content, filename);
    if (!sentToNative) {
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

/**
 * Imports a project from a .zip file into IndexedDB.
 * Returns the project ID for navigation.
 */
export async function importProjectFromZip(file: File): Promise<string> {
    const zip = await JSZip.loadAsync(file);

    // Read project JSON
    const projectFile = zip.file('project.json');
    if (!projectFile) throw new Error('Invalid archive: missing project.json');
    const projectJson = await projectFile.async('string');
    const project: Project = JSON.parse(projectJson);

    // Read manifest
    const manifestFile = zip.file('manifest.json');
    const manifest: BlobManifest = manifestFile
        ? JSON.parse(await manifestFile.async('string'))
        : {};

    // Restore blobs
    const blobFolder = zip.folder('blobs');
    if (blobFolder) {
        const blobFiles: { name: string; file: JSZip.JSZipObject }[] = [];
        blobFolder.forEach((relativePath, file) => {
            blobFiles.push({ name: relativePath, file });
        });

        for (const { name, file } of blobFiles) {
            const blobId = name.replace('.bin', '');
            const data = await file.async('arraybuffer');
            const mimeType = manifest[blobId]?.mimeType || 'application/octet-stream';
            const blob = new Blob([data], { type: mimeType });
            console.log(`[Import] Restored blob: ${blobId} (${mimeType}, ${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
            await LocalStorage.saveRecordingBlob(blobId, blob);
        }
    }

    // Restore thumbnail
    const thumbnailFile = zip.file('thumbnail.bin');
    if (thumbnailFile) {
        const data = await thumbnailFile.async('arraybuffer');
        const blob = new Blob([data], { type: 'image/jpeg' });
        await LocalStorage.saveThumbnail(project.id, blob);
    }

    // Save project
    await LocalStorage.saveProject(project);

    // Diagnostic: verify the stored project can be loaded and hydrated
    const loaded = await LocalStorage.loadProject(project.id);
    if (loaded) {
        console.log('[Import] Verification — screenSource:', {
            storageUrl: loaded.screenSource?.storageUrl,
            runtimeUrl: loaded.screenSource?.runtimeUrl,
            hasRuntimeUrl: !!loaded.screenSource?.runtimeUrl,
        });
        if (loaded.cameraSource?.storageUrl) {
            console.log('[Import] Verification — cameraSource:', {
                storageUrl: loaded.cameraSource?.storageUrl,
                runtimeUrl: loaded.cameraSource?.runtimeUrl,
            });
        }
    } else {
        console.error('[Import] FAILED to reload project after save!');
    }

    return project.id;
}
