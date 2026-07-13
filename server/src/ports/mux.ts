/**
 * Mux port — the edge functions use exactly two REST calls plus webhook
 * signature verification (HMAC-SHA256 over `${timestamp}.${body}` from the
 * `mux-signature` header).
 */
export interface MuxPort {
    /** POST /video/v1/assets with a signed download URL, public playback policy */
    createAsset(inputUrl: string): Promise<{ assetId: string }>;
    /** DELETE /video/v1/assets/:id — 404 (already gone) counts as success */
    deleteAsset(assetId: string): Promise<void>;
    verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
}
