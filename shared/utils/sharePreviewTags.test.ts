import { describe, expect, it } from 'vitest';
import { buildSharePreview } from './sharePreviewTags';

const URLS = {
    pageUrl: 'https://app.recordio.io/video/k3f9x2m1p0qa',
    imageUrl: 'https://api.example.com/shared-video-preview-image/k3f9x2m1p0qa',
};

/** content="…" of the tag with this name/property */
function content(headHtml: string, key: string): string | undefined {
    const match = headHtml.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`));
    return match?.[1];
}

describe('buildSharePreview', () => {
    it('public video: title, owner · duration, large image card', () => {
        const { title, headHtml } = buildSharePreview(
            { name: 'New billing flow', ownerName: 'Sam Rivera', durationMs: 222_900 },
            URLS,
        );
        expect(title).toBe('New billing flow · Recordio');
        expect(content(headHtml, 'og:title')).toBe('New billing flow');
        expect(content(headHtml, 'og:description')).toBe('Sam Rivera · 3:42');
        expect(content(headHtml, 'description')).toBe('Sam Rivera · 3:42');
        expect(content(headHtml, 'og:type')).toBe('video.other');
        expect(content(headHtml, 'og:url')).toBe(URLS.pageUrl);
        expect(content(headHtml, 'og:image')).toBe(URLS.imageUrl);
        expect(content(headHtml, 'og:image:width')).toBe('1200');
        expect(content(headHtml, 'og:image:height')).toBe('675');
        expect(content(headHtml, 'twitter:card')).toBe('summary_large_image');
        expect(content(headHtml, 'twitter:image')).toBe(URLS.imageUrl);
    });

    it('omits the duration when unknown', () => {
        const { headHtml } = buildSharePreview({ name: 'Demo', ownerName: 'Sam Rivera' }, URLS);
        expect(content(headHtml, 'og:description')).toBe('Sam Rivera');
    });

    it('not public: generic wording that reveals nothing, same image URL', () => {
        const { title, headHtml } = buildSharePreview(null, URLS);
        expect(title).toBe('Recordio');
        expect(content(headHtml, 'og:title')).toBe('Recordio video');
        expect(content(headHtml, 'og:description')).toBe('This video is shared privately. Sign in to Recordio to watch.');
        expect(content(headHtml, 'og:type')).toBe('website');
        expect(content(headHtml, 'og:image')).toBe(URLS.imageUrl);
    });

    it('escapes user-controlled text so it cannot break out of the attribute', () => {
        const name = `"><script>alert('x')</script> & co`;
        const { title, headHtml } = buildSharePreview({ name, ownerName: '<b>Sam</b>' }, URLS);
        expect(headHtml).not.toContain('<script>');
        expect(headHtml).not.toContain('<b>');
        expect(content(headHtml, 'og:title'))
            .toBe('&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co');
        expect(content(headHtml, 'og:description')).toBe('&lt;b&gt;Sam&lt;/b&gt;');
        // <title> stays raw text — the function sets it with setInnerContent (text mode)
        expect(title).toBe(`${name} · Recordio`);
    });
});
