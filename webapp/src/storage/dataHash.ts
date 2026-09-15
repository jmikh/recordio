/**
 * SHA-256 hex of a JSON-serialisable value — the "did anything change?"
 * check both the project and screenshot services use to skip no-op cloud
 * writes (an unchanged save must not bump cloud_version).
 */
export async function dataHash(value: unknown): Promise<string> {
    const json = JSON.stringify(value);
    const buffer = new TextEncoder().encode(json);
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of a blob's bytes (thumbnail dedupe). */
export async function blobHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
