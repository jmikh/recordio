/**
 * Real Mux adapter — landed with mux-video-create. Raw fetch, no
 * `@mux/mux-node` package: the surface is two REST calls with basic auth.
 *
 * `webhookSecret` is optional until Wave D: mux-video-hook lands the
 * required MUX_WEBHOOK_SECRET env var together with the HMAC
 * verification — until then verifyWebhookSignature fails loudly.
 */
import { MuxApiError, type MuxPort } from '../ports/mux.js';

export interface MuxAdapterConfig {
    tokenId: string;
    tokenSecret: string;
    /** Lands with Wave D (mux-video-hook) */
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

        verifyWebhookSignature() {
            if (!config.webhookSecret) {
                throw new Error('MuxAdapter: webhookSecret not configured (MUX_WEBHOOK_SECRET lands with Wave D)');
            }
            throw new Error('MuxAdapter.verifyWebhookSignature: implemented in Wave D (mux-video-hook)');
        },
    };
}
