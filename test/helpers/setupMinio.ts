/**
 * Creates the `project-media` bucket in local MinIO if it doesn't exist.
 *
 * Run after `docker compose up -d minio`.
 *
 * Can be called from tests (globalSetup) or manually:
 *   npx tsx test/helpers/setupMinio.ts
 */

import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { s3 } from './s3Client';

const BUCKET = 'project-media';

export async function ensureBucket(): Promise<void> {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
        console.log(`[MinIO] Bucket "${BUCKET}" already exists`);
        return;
    } catch {
        // Bucket doesn't exist — create it
    }

    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`[MinIO] Bucket "${BUCKET}" created`);
}

// Allow running directly: npx tsx test/helpers/setupMinio.ts
const isDirectRun = !process.argv[1] || process.argv[1].endsWith('setupMinio.ts');
if (isDirectRun) {
    ensureBucket()
        .then(() => console.log('[MinIO] Setup complete'))
        .catch((err) => {
            console.error('[MinIO] Setup failed:', err);
            process.exit(1);
        });
}
