import { test, expect, type Page } from '@playwright/test';
import {
    currentWorkspace,
    loadStripeEnv,
    postSignedWebhook,
    resetBilling,
    seedProSubscription,
    waitForCheckoutComplete,
    type E2eWorkspace,
} from '../fixtures/billing';
import { BILLING_USER } from '../fixtures/testUser';

/**
 * Billing — seat pre-purchase (plans/seat-prepurchase-oneshot.md): seats
 * are bought before people are invited. Runs against the local stack
 * with the server's Stripe TEST-MODE keys (server/.env.local); no
 * `stripe listen` needed — the fixture delivers the signed webhook.
 *
 * Both tests mutate their workspace's subscription, so they run on the
 * dedicated billing user (billing.setup.ts signs it in), serially, and
 * each starts and ends on a subscription-free, solo workspace.
 */
const stripeEnv = loadStripeEnv();

test.describe('billing (seat pre-purchase)', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!stripeEnv, 'Stripe test-mode keys missing in server/.env.local — see e2e/README.md');

    let ws: E2eWorkspace;

    test.beforeAll(async () => {
        ws = await currentWorkspace();
        await resetBilling(stripeEnv, ws.workspaceId);
    });

    test.afterEach(async () => {
        await resetBilling(stripeEnv, ws.workspaceId);
    });

    test('owner upgrades to Pro through Stripe Checkout', async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto('/workspace/settings/billing');
        const upgrade = page.getByRole('button', { name: 'Upgrade to Pro', exact: true });
        await expect(upgrade).toBeVisible();
        // Solo owner → the checkout starts at one seat
        await expect(page.getByLabel('Seats', { exact: true })).toHaveText('1');

        const [popup] = await Promise.all([page.waitForEvent('popup'), upgrade.click()]);
        await popup.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
        await expect(page.getByText('Waiting for payment')).toBeVisible();
        const sessionId = popup.url().match(/cs_test_[A-Za-z0-9]+/)?.[0];
        expect(sessionId, 'checkout session id in the popup URL').toBeTruthy();

        await payOnHostedCheckout(popup);

        // Stripe can't reach localhost without `stripe listen` — deliver the
        // completed session to the server the way Stripe would
        const session = await waitForCheckoutComplete(stripeEnv!, sessionId!);
        await postSignedWebhook(stripeEnv!, 'checkout.session.completed', session);

        await expect(page.getByText('Subscription activated')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Pro · 1 seat')).toBeVisible();
        await expect(upgrade).toHaveCount(0);

        // Survives a reload — the row is really there
        await page.reload();
        await expect(page.getByText('Pro · 1 seat')).toBeVisible();
        await expect(page.getByRole('img', { name: /1 of 1 seat used/ })).toBeVisible();
    });

    test('owner buys seats, then invites creators up to the limit', async ({ page }) => {
        await seedProSubscription(stripeEnv!, {
            workspaceId: ws.workspaceId,
            userId: ws.userId,
            email: BILLING_USER.email,
            seats: 1,
        });

        await page.goto('/workspace/settings/billing');
        await expect(page.getByText('Pro · 1 seat')).toBeVisible();
        await expect(page.getByRole('img', { name: /1 of 1 seat used/ })).toBeVisible();

        // Buy two more seats
        const addSeat = page.getByRole('button', { name: 'Add seat', exact: true });
        await addSeat.click();
        await addSeat.click();
        await expect(page.getByLabel('Seats', { exact: true })).toHaveText('3');
        await expect(page.getByText(/Charged today: \$/)).toBeVisible({ timeout: 20_000 });
        await page.getByRole('button', { name: 'Update seats' }).click();
        await expect(page.getByText('Seats updated to 3')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Pro · 3 seats')).toBeVisible();
        await expect(page.getByRole('img', { name: /1 of 3 seats used/ })).toBeVisible();

        await page.reload();
        await expect(page.getByText('Pro · 3 seats')).toBeVisible();
        await expect(page.getByRole('img', { name: /1 of 3 seats used/ })).toBeVisible();

        // Two creator invites fill the purchased seats…
        await invite(page, 'e2e-creator-a@example.com', 'Creator');
        await invite(page, 'e2e-creator-b@example.com', 'Creator');
        await expect(page.getByRole('img', { name: /2 reserved by pending invitations/ })).toBeVisible();
        // …so a further creator invite is REFUSED rather than quietly downgraded
        // to a viewer: the picker keeps the admin's choice and the send is blocked.
        await expect(page.getByRole('button', { name: 'Invite role' })).toHaveText(/Creator/);
        await expect(page.getByText('No creator seats left')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Send Invite' })).toBeDisabled();

        // Viewers are free — still invitable once the admin picks that role
        await invite(page, 'e2e-viewer@example.com', 'Viewer');
    });
});

/** Fill the invite form and confirm the invitation shows up as pending. */
async function invite(page: Page, email: string, role: 'Creator' | 'Viewer') {
    await page.getByLabel('Teammate email').fill(email);
    const picker = page.getByRole('button', { name: 'Invite role' });
    if (!(await picker.textContent())?.includes(role)) {
        await picker.click();
        await page.getByRole('button', { name: role, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Send Invite' }).click();
    await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
}

/**
 * Stripe's hosted test-mode Checkout page: pick "Card" from the payment
 * method chooser (the fields only render after that), the 4242 test card,
 * any future expiry, any CVC. Country/postal/Link controls only appear for
 * some accounts, so each is filled only when present. Stripe redirects the
 * popup to success_url once the payment settles.
 */
async function payOnHostedCheckout(popup: Page) {
    const card = popup.locator('#cardNumber');
    const cardChoices = [
        popup.getByTestId('card-accordion-item'),
        popup.getByRole('radio', { name: /^card$/i }),
        popup.getByText('Card', { exact: true }),
    ];
    await expect(card.or(cardChoices[2].first())).toBeVisible({ timeout: 60_000 });
    if (!(await card.isVisible())) {
        for (const choice of cardChoices) {
            const el = choice.first();
            if (await el.isVisible()) {
                await el.click();
                break;
            }
        }
    }
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.pressSequentially('4242424242424242');
    await popup.locator('#cardExpiry').pressSequentially('1234');
    await popup.locator('#cardCvc').pressSequentially('123');

    const name = popup.locator('#billingName');
    if (await name.isVisible()) await name.fill('E2E Tester');
    const country = popup.locator('#billingCountry');
    if (await country.isVisible()) await country.selectOption('US');
    const postal = popup.locator('#billingPostalCode');
    if (await postal.isVisible()) await postal.fill('94103');
    const savePass = popup.locator('#enableStripePass');
    if ((await savePass.isVisible()) && (await savePass.isChecked())) await savePass.uncheck();

    await popup.locator('button[type="submit"]').first().click();
    await popup.waitForURL(/\/workspace\/settings\/billing/, { timeout: 90_000 }).catch(() => {});
    await popup.close().catch(() => {});
}
