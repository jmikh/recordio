import type { MuxPort } from '../../src/ports/mux.js';

/** The only signature header the fake accepts. */
export const FAKE_MUX_SIGNATURE = 'fake-valid-mux-signature';

export interface FakeMux extends MuxPort {
    createdAssets: Array<{ assetId: string; inputUrl: string }>;
    deletedAssetIds: string[];
}

export function createFakeMux(): FakeMux {
    const fake: FakeMux = {
        createdAssets: [],
        deletedAssetIds: [],

        async createAsset(inputUrl) {
            const assetId = `fake-mux-asset-${fake.createdAssets.length + 1}`;
            fake.createdAssets.push({ assetId, inputUrl });
            return { assetId };
        },
        async deleteAsset(assetId) {
            fake.deletedAssetIds.push(assetId);
        },
        verifyWebhookSignature(_rawBody, signatureHeader) {
            return signatureHeader === FAKE_MUX_SIGNATURE;
        },
    };
    return fake;
}
