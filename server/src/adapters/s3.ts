/**
 * Real S3 adapter (AWS SDK v3) — first landed with storage-download-urls.
 *
 * Thin translation only (see server/README.md): the bucket is fixed here,
 * config comes in as plain values, and no method contains branching logic.
 * Matches the edge functions' client setup (_shared + storage-download-urls):
 * path-style addressing against an S3-compatible endpoint.
 */
import {
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Port } from '../ports/s3.js';

const BUCKET = 'project-media';

export interface S3AdapterConfig {
    region: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
}

export function createS3Adapter(config: S3AdapterConfig): S3Port {
    const client = new S3Client({
        forcePathStyle: true,
        region: config.region,
        endpoint: config.endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });

    return {
        async presignDownload(key, expiresInSeconds = 3600) {
            const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
            return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
        },
        async presignUpload(key, expiresInSeconds = 3600) {
            const command = new PutObjectCommand({ Bucket: BUCKET, Key: key });
            return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
        },
        async putObject(key, body, contentType) {
            await client.send(
                new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
            );
        },
        async getObject(key) {
            const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            return new Uint8Array(await res.Body!.transformToByteArray());
        },
        async listObjects(prefix) {
            const keys: string[] = [];
            let continuationToken: string | undefined;
            do {
                const res = await client.send(
                    new ListObjectsV2Command({
                        Bucket: BUCKET,
                        Prefix: prefix,
                        ContinuationToken: continuationToken,
                    }),
                );
                for (const obj of res.Contents ?? []) {
                    if (obj.Key) keys.push(obj.Key);
                }
                continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
            } while (continuationToken);
            return keys;
        },
        async deleteObjects(keys) {
            // DeleteObjects caps at 1000 keys per request
            for (let i = 0; i < keys.length; i += 1000) {
                const chunk = keys.slice(i, i + 1000);
                await client.send(
                    new DeleteObjectsCommand({
                        Bucket: BUCKET,
                        Delete: { Objects: chunk.map((Key) => ({ Key })) },
                    }),
                );
            }
        },
    };
}
