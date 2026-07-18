/**
 * S3 port — everything operates on the single `project-media` bucket
 * (fixed in the adapter). No multipart: the edge functions only ever
 * presign plain GET/PUT (1h expiry) and do two direct transfers
 * (thumbnail upload, mic download for transcription). The bulk
 * operations landed with the Wave C purge jobs.
 */
export interface S3Port {
    presignDownload(key: string, expiresInSeconds?: number): Promise<string>;
    presignUpload(key: string, expiresInSeconds?: number): Promise<string>;
    putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
    getObject(key: string): Promise<Uint8Array>;
    /** All keys under the prefix, RECURSIVE (unlike Supabase Storage's one-level list) */
    listObjects(prefix: string): Promise<string[]>;
    /** Batch delete; no-op on an empty array */
    deleteObjects(keys: string[]): Promise<void>;
}
