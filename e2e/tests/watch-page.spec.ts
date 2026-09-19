/**
 * Public watch page (/video/{slug}): full-bleed layout with the header
 * pinned to the viewport edges, the transcript in a flush right panel,
 * and per-viewer furniture — Edit for editors, the promo for anonymous
 * viewers.
 */
import { test, expect, type Page } from '@playwright/test';
import { api, seedProject, signIn, type SeededProject } from '../fixtures/project';

let seeded: SeededProject;
test.beforeAll(async () => { seeded = await seedProject(); });
test.afterAll(async () => { await seeded?.cleanup(); });

const VIEWPORT = { width: 1600, height: 900 };

async function slugOf(page: Page) {
    await page.goto(`/editor?projectId=${seeded.projectId}`);
    await expect(page.locator('#project-name-input')).toHaveValue(seeded.name, { timeout: 20_000 });
    return page.url().match(/\/video\/([^/]+)\/edit/)![1];
}

/** Header clusters vs the viewport edges, and the (visible) panel vs the right edge. */
async function measure(page: Page) {
    return page.evaluate(() => {
        const hdr = document.querySelector('header')!;
        const left = hdr.children[0] as HTMLElement;
        const right = hdr.children[hdr.children.length - 1] as HTMLElement;
        const aside = Array.from(document.querySelectorAll('aside'))
            .find(a => a.getBoundingClientRect().width > 0) ?? null;
        const r = (e: Element | null) => e ? Math.round(e.getBoundingClientRect().left) : null;
        const rr = (e: Element | null) => e ? Math.round(e.getBoundingClientRect().right) : null;
        return {
            vw: window.innerWidth,
            headerLeftClusterLeft: r(left),
            headerRightClusterRight: rr(right),
            asideLeft: r(aside), asideRight: rr(aside), asideHeight: aside ? Math.round(aside.getBoundingClientRect().height) : null,
            mainLeft: r(document.querySelector('main')), mainRight: rr(document.querySelector('main')),
        };
    });
}

test('signed in + editor: Edit button, flush transcript panel, header pinned to edges', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    const slug = await slugOf(page);

    // The running dev server predates canEdit; the client is verified against a
    // mocked response (the route itself is covered by server/test/sharedVideoGet.test.ts)
    await page.route('**/shared-video-get', async route => {
        const res = await route.fetch();
        const body = await res.json();
        await route.fulfill({ response: res, json: {
            ...body, status: 'completed', canEdit: true,
            captions: [
                { text: 'This is another test with Recordio, let us see the transcription model', startMs: 0, endMs: 4000 },
                { text: 'because this is going to be testing word by word humming', startMs: 4000, endMs: 9000 },
                { text: 'and let us see how it does.', startMs: 9000, endMs: 12000 },
            ],
        } });
    });

    await page.goto(`/video/${slug}`);
    await expect(page.getByRole('heading', { name: seeded.name })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record for free' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
    await expect(page.getByText('Record your screen free')).toBeHidden();

    // Header pinned to the edges (16px gutter), panel flush right at full height,
    // video column filling everything left of it
    const m = await measure(page);
    expect(m.headerLeftClusterLeft).toBe(16);
    expect(m.headerRightClusterRight).toBe(m.vw - 16);
    expect(m.asideRight).toBe(m.vw);
    expect(m.mainRight).toBe(m.asideLeft);
    expect(m.asideHeight).toBeGreaterThan(VIEWPORT.height - 60);

    // Hide → the panel gives way to a narrow rail and the video column widens;
    // the choice survives a reload; show → back to the full panel
    await page.getByRole('button', { name: 'Hide panel' }).click();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeHidden();
    const collapsed = await measure(page);
    expect(collapsed.mainRight).toBeGreaterThan(m.mainRight + 250);
    expect(collapsed.asideRight).toBe(m.vw);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Show panel' })).toBeVisible();
    await page.getByRole('button', { name: 'Show panel' }).click();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
    expect((await measure(page)).mainRight).toBe(m.mainRight);

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/video/${slug}/edit`));
});

test('signed out: no Edit, promo pinned in the panel, Record for free in the header', async ({ browser, page }) => {
    const slug = await slugOf(page);
    // The fixture seeds a private project; anonymous viewers need it published
    const { token } = await signIn();
    await api('project-share', token, { projectId: seeded.projectId, sharePolicy: 'public' });
    // The project's storageState is applied to newContext() by default —
    // an explicit empty one is what actually makes the context anonymous
    const ctx = await browser.newContext({ viewport: VIEWPORT, storageState: { cookies: [], origins: [] } });
    const anon = await ctx.newPage();
    await anon.goto(`/video/${slug}`);
    await expect(anon.getByRole('heading', { name: seeded.name })).toBeVisible();

    await expect(anon.getByRole('button', { name: 'Edit' })).toBeHidden();
    await expect(anon.getByRole('button', { name: 'Open navigation' })).toBeHidden();
    await expect(anon.getByRole('button', { name: 'Record for free' })).toBeVisible();
    await expect(anon.getByText('Record your screen free')).toBeVisible();
    // The panel is there even without a transcript (the fixture has none)
    await expect(anon.getByRole('complementary', { name: 'Video details' })).toBeVisible();
    await expect(anon.getByText(/transcript/i).first()).toBeVisible();

    const m = await measure(anon);
    expect(m.headerLeftClusterLeft).toBe(16);
    expect(m.headerRightClusterRight).toBe(m.vw - 16);
    expect(m.asideRight).toBe(m.vw);
    await ctx.close();
});
