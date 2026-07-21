/**
 * Real Mux adapter — landed with mux-video-create. Raw fetch, no
 * `@mux/mux-node` package: the surface is two REST calls with basic auth
 * plus webhook signature verification (Wave D #16).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MuxApiError, type MuxPort } from '../ports/mux.js';

export interface MuxAdapterConfig {
    tokenId: string;
    tokenSecret: string;
    /**
     * Signing secret of the Mux webhook ENDPOINT (each endpoint has its
     * own — MUX_WEBHOOK_SECRET). Optional in the type so tests can build
     * the adapter without it; verifyWebhookSignature throws when absent.
     */
    webhookSecret?: string;
    /** Test override (ephemeral local server) */
    baseUrl?: string;
}

export function createMuxAdapter(config: MuxAdapterConfig): MuxPort {
    const baseUrl = config.baseUrl ?? 'https://api.mux.com';
    const auth = `Basic ${Buffer.from(`${config.tokenId}:${config.tokenSecret}`).toString('base64')}`;

    async function errorSnippet(res: Response): Promise<string> {
        return (await res.text().catch(() => '')).slice(0, 300);
    }

    return {
        async createAsset(inputUrl) {
            const res = await fetch(`${baseUrl}/video/v1/assets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: auth,
                },
                body: JSON.stringify({
                    input: [{ url: inputUrl }],
                    playback_policy: ['public'],
                }),
            });
            if (!res.ok) {
                throw new MuxApiError(res.status, await errorSnippet(res));
            }
            const body = (await res.json()) as { data: { id: string } };
            return { assetId: body.data.id };
        },

        async deleteAsset(assetId) {
            const res = await fetch(`${baseUrl}/video/v1/assets/${assetId}`, {
                method: 'DELETE',
                headers: { Authorization: auth },
            });
            // 404 = already gone, counts as success (port contract)
            if (!res.ok && res.status !== 404) {
                throw new MuxApiError(res.status, await errorSnippet(res));
            }
        },

        verifyWebhookSignature(rawBody, signatureHeader) {
            if (!config.webhookSecret) {
                throw new Error('MuxAdapter: webhookSecret not configured (MUX_WEBHOOK_SECRET)');
            }
            // Mux signatures: t=<timestamp>,v1=<hex>. A malformed header is
            // just a failed verification (the edge fn's separate 401 body
            // for it collapses into 'Invalid signature' — Mux reads neither).
            const elements = signatureHeader.split(',');
            const timestamp = elements.find((e) => e.startsWith('t='))?.slice(2);
            const v1Sig = elements.find((e) => e.startsWith('v1='))?.slice(3);
            if (!timestamp || !v1Sig) return false;

            // No timestamp tolerance check — edge-fn parity (logged smell:
            // unlimited replay window)
            const expectedHex = createHmac('sha256', config.webhookSecret)
                .update(`${timestamp}.${rawBody}`)
                .digest('hex');
            // Compare the hex STRINGS as buffers: exact `===` accept/reject
            // semantics of the edge fn, hardened to constant time
            const expected = Buffer.from(expectedHex);
            const received = Buffer.from(v1Sig);
            return expected.length === received.length && timingSafeEqual(expected, received);
        },
    };
}
