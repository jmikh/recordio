/**
 * Render worker port — one fire-and-forget POST /render with bearer auth.
 * `statusCallbackUrl` stays the Supabase render-job-hook URL until Wave D.
 */
export interface RenderJobSubmission {
    jobId: string;
    projectData: unknown;
    projectName: string;
    quality: string;
    /** storagePath → presigned download URL */
    mediaUrls: Record<string, string>;
    /** presigned PUT URL for the rendered MP4 */
    uploadUrl: string;
    statusCallbackUrl: string;
}

export interface RenderWorkerPort {
    submitJob(job: RenderJobSubmission): Promise<void>;
}
