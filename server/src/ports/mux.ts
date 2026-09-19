/**
 * Mux port — the edge functions use exactly two REST calls plus webhook
 * signature verification (HMAC-SHA256 over `${timestamp}.${body}` from the
 * `mux-signature` header).
 */

/**
 * Thrown by adapters when Mux answered with a non-2xx — distinct from a
 * network/transport failure (plain Error) because callers map the two to
 * different mux_videos error strings (edge-fn parity, see muxUpload).
 */
export class MuxApiError extends Error {
    constructor(
        public readonly status: number,
        bodySnippet: string,
    ) {
        super(`Mux API responded ${status}: ${bodySnippet}`);
        this.name = 'MuxApiError';
    }
}

/**
 * Ownership metadata attached to every Mux asset so the Mux dashboard,
 * Data/analytics and webhook payloads can be traced back to our rows
 * without a DB lookup. Sent as Mux `meta` (title / creator_id /
 * external_id) plus a JSON `passthrough` carrying the full set.
 */
export interface MuxAssetMeta {
    projectId: string;
    workspaceId: string;
    /** Project OWNER (mux_videos.user_id), never the caller */
    creatorId: string;
    cloudVersion: number;
    /** Project name — becomes meta.title (Mux caps it at 512 chars) */
    title: string;
}

export interface MuxPort {
    /** POST /video/v1/assets with a signed download URL, public playback policy + ownership metadata */
    createAsset(inputUrl: string, meta: MuxAssetMeta): Promise<{ assetId: string }>;
    /** DELETE /video/v1/assets/:id — 404 (already gone) counts as success */
    deleteAsset(assetId: string): Promise<void>;
    verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
}
