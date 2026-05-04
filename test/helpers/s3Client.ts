/**
 * S3 client for test helpers — talks to local MinIO.
 *
 * Used to upload test media and generate presigned URLs,
 * mirroring what the edge functions do in production.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'node:fs';

const BUCKET = 'project-media';

export const s3 = new S3Client({
    forcePathStyle: true,
    region: 'us-east-1',
    endpoint: 'http://127.0.0.1:9000',
    credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
    },
});

/** Upload a local file to MinIO under the given storage path. */
export async function uploadToMinio(storagePath: string, localPath: string): Promise<void> {
    const body = fs.readFileSync(localPath);
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: storagePath,
        Body: body,
    }));
}

/** Generate a presigned GET URL (download). */
export async function presignedDownloadUrl(storagePath: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: storagePath });
    return getSignedUrl(s3, command, { expiresIn: 3600 });
}

/** Generate a presigned PUT URL (upload). */
export async function presignedUploadUrl(storagePath: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: storagePath });
    return getSignedUrl(s3, command, { expiresIn: 3600 });
}

/** Check if an object exists in MinIO. */
export async function objectExists(storagePath: string): Promise<boolean> {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: storagePath }));
        return true;
    } catch {
        return false;
    }
}
