/**
 * Narrow integration test for the real S3 adapter (see server/README.md:
 * adapter tests live in a separate, optional tier — allowed slow, never
 * blocks the pipeline). Verifies the thin translation the fakes can't:
 * real presigning, real put/get against an S3-compatible endpoint.
 *
 * Skipped unless S3_* env is present. Locally: `supabase start` storage
 * (creds in server/.env.example); the `project-media` bucket must exist.
 * Writes only under the `_adapter-test/` prefix and deletes after itself.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createS3Adapter } from '../../src/adapters/s3.js';

const { S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
const hasEnv = Boolean(S3_REGION && S3_ENDPOINT && S3_ACCESS_KEY && S3_SECRET_KEY);

const key = `_adapter-test/${randomUUID()}.txt`;
const body = new TextEncoder().encode('s3 adapter integration test');

describe.runIf(hasEnv)('S3 adapter (real endpoint)', () => {
    const config = {
        region: S3_REGION!,
        endpoint: S3_ENDPOINT!,
        accessKeyId: S3_ACCESS_KEY!,
        secretAccessKey: S3_SECRET_KEY!,
    };
    const s3 = createS3Adapter(config);

    afterAll(async () => {
        const client = new S3Client({
            forcePathStyle: true,
            region: config.region,
            endpoint: config.endpoint,
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        });
        await client.send(new DeleteObjectCommand({ Bucket: 'project-media', Key: key }));
    });

    it('putObject → getObject roundtrip', async () => {
        await s3.putObject(key, body, 'text/plain');
        expect(await s3.getObject(key)).toEqual(body);
    });

    it('presignDownload returns a fetchable URL for the object', async () => {
        const url = await s3.presignDownload(key, 60);
        const res = await fetch(url);
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
    });

    it('presignUpload returns a URL that accepts a PUT', async () => {
        const url = await s3.presignUpload(key, 60);
        const res = await fetch(url, { method: 'PUT', body });
        expect(res.ok).toBe(true);
    });
});
