/**
 * Stripe adapter — verifyWebhook only, self-contained (real signature
 * vectors from the SDK's own `generateTestHeaderString`, no HTTP), so it
 * runs in the merge-blocking tier. The API-calling methods live in
 * `stripe.integration.test.ts` (third-party tier, auto-skips without a
 * test-mode key).
 */
import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { createStripeAdapter } from '../../src/adapters/stripe.js';

const SECRET = 'whsec_test_secret';
// Only webhook signing is exercised — the api key is never used
const signer = new Stripe('sk_test_dummy');

const EVENT = {
    id: 'evt_test_1',
    type: 'customer.subscription.updated',
    created: 1_721_600_000,
    data: { object: { id: 'sub_1', status: 'active' } },
};
const PAYLOAD = JSON.stringify(EVENT);

function header(payload: string, secret = SECRET, timestamp?: number) {
    return signer.webhooks.generateTestHeaderString({
        payload,
        secret,
        ...(timestamp !== undefined ? { timestamp } : {}),
    });
}

function adapter() {
    return createStripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: SECRET });
}

describe('stripe adapter — verifyWebhook', () => {
    it('accepts a valid signature and returns the port-shaped event', async () => {
        const event = await adapter().verifyWebhook(PAYLOAD, header(PAYLOAD));
        expect(event).toEqual({
            id: 'evt_test_1',
            type: 'customer.subscription.updated',
            created: 1_721_600_000,
            data: { object: { id: 'sub_1', status: 'active' } },
        });
    });

    it('throws when the body was tampered with', async () => {
        const tampered = PAYLOAD.replace('active', 'paused');
        await expect(adapter().verifyWebhook(tampered, header(PAYLOAD))).rejects.toThrow();
    });

    it('throws on a signature made with a different secret', async () => {
        await expect(
            adapter().verifyWebhook(PAYLOAD, header(PAYLOAD, 'whsec_wrong')),
        ).rejects.toThrow();
    });

    it('throws on a garbage header', async () => {
        await expect(adapter().verifyWebhook(PAYLOAD, 'not-a-stripe-signature')).rejects.toThrow();
    });

    it('throws on a stale timestamp beyond the SDK default 300 s tolerance (replay guard)', async () => {
        const stale = Math.floor(Date.now() / 1000) - 400;
        await expect(
            adapter().verifyWebhook(PAYLOAD, header(PAYLOAD, SECRET, stale)),
        ).rejects.toThrow(/timestamp outside the tolerance zone/i);
    });

    it('fails loudly without a configured secret', async () => {
        const bare = createStripeAdapter({ secretKey: 'sk_test_dummy' });
        await expect(bare.verifyWebhook(PAYLOAD, header(PAYLOAD))).rejects.toThrow('not configured');
    });
});
