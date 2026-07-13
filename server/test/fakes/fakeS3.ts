import type { S3Port } from '../../src/ports/s3.js';

export interface FakeS3 extends S3Port {
    presignedDownloads: Array<{ key: string; expiresInSeconds: number }>;
    presignedUploads: Array<{ key: string; expiresInSeconds: number }>;
    /** Objects "stored" via putObject; seedable for getObject reads */
    objects: Map<string, { body: Uint8Array; contentType: string }>;
}

export function createFakeS3(): FakeS3 {
    const fake: FakeS3 = {
        presignedDownloads: [],
        presignedUploads: [],
        objects: new Map(),

        async presignDownload(key, expiresInSeconds = 3600) {
            fake.presignedDownloads.push({ key, expiresInSeconds });
            return `https://fake-s3/get/${key}`;
        },
        async presignUpload(key, expiresInSeconds = 3600) {
            fake.presignedUploads.push({ key, expiresInSeconds });
            return `https://fake-s3/put/${key}`;
        },
        async putObject(key, body, contentType) {
            fake.objects.set(key, { body, contentType });
        },
        async getObject(key) {
            const obj = fake.objects.get(key);
            if (!obj) throw new Error(`FakeS3: no such object ${key}`);
            return obj.body;
        },
    };
    return fake;
}
