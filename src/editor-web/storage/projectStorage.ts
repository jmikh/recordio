/**
 * Website Project Storage
 * 
 * Re-exports the main ProjectStorage which automatically uses 'recordio-editor'
 * database when running on the website (detected by origin).
 * 
 * Also provides the importFromRawRecording function for the handoff flow.
 */

import type { Project, SourceMetadata, RawRecording } from '../../shared/types';
import { ProjectStorage } from '../../storage/projectStorage';
import { ProjectImpl } from '../../core/Project';

// Re-export everything from main storage
export { ProjectStorage };

// Convenience exports for direct function calls
export const saveProject = (project: Project) => ProjectStorage.saveProject(project);
export const getProject = (projectId: string) => ProjectStorage.loadProject(projectId);
export const getAllProjects = () => ProjectStorage.listProjects();
export const deleteProject = (projectId: string) => ProjectStorage.deleteProject(projectId);
export const saveBlob = (id: string, blob: Blob) => ProjectStorage.saveRecordingBlob(id, blob);
export const getBlob = (id: string) => ProjectStorage.getRecordingBlob(id);
export const deleteBlob = (id: string) => ProjectStorage.deleteRecordingBlob(id);

// ============================================
// Import from RawRecording (for handoff flow)
// ============================================

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
    const screenSource: SourceMetadata = {
        ...recording.screenSource,
        id: `src-${projectId}-screen`,
        storageUrl: `recordio-blob://${screenBlobId}`,
    };

    let cameraSource: SourceMetadata | undefined;
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
        cameraSource
    );

    // 4. Save project
    await ProjectStorage.saveProject(project);

    console.log('[ProjectStorage] Imported recording as project:', projectId);
    return project;
}
