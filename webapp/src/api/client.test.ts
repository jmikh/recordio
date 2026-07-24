import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
    supabase: {
        auth: { getSession: vi.fn() },
    },
}));

// Keep the real module (authAwareFetch + the unauthorized-handler funnel are
// what the 401 test exercises) but swap in a controllable supabase instance.
vi.mock('../supabase/client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../supabase/client')>()),
    supabase: mocks.supabase,
}));

// authAwareFetch wraps sentryFetch; bypass its Sentry/store imports and go
// straight to (stubbed) global fetch.
vi.mock('../supabase/sentryFetch', () => ({
    sentryFetch: (url: RequestInfo | URL, options?: RequestInit) => fetch(url, options),
}));

import { invokeFunction } from './client';
import { setUnauthorizedHandler } from '../supabase/client';

const FN = 'test-fn';
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_API_URL', 'http://localhost:8090');
    mocks.supabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
    });
    setUnauthorizedHandler(vi.fn());
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('invokeFunction (server-only since the Step 5 decommission)', () => {
    it('POSTs to ${VITE_API_URL}/${name} with the session bearer and JSON body', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ via: 'server' }));

        const result = await invokeFunction(FN, { a: 1 });

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://localhost:8090/test-fn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer test-token',
            },
            body: JSON.stringify({ a: 1 }),
        });
        expect(result).toEqual({ data: { via: 'server' }, error: null });
    });

    it('passes a FormData body through untouched with no JSON content-type', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ storagePath: 'u/p/thumbnail.webp' }));

        const form = new FormData();
        form.append('projectId', 'p-1');
        form.append('file', new Blob(['x'], { type: 'image/webp' }), 'thumbnail.webp');

        const result = await invokeFunction(FN, form);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:8090/test-fn');
        // The exact instance — no JSON.stringify — and no Content-Type so
        // the browser sets the multipart boundary
        expect(options.body).toBe(form);
        expect(options.headers).toEqual({ Authorization: 'Bearer test-token' });
        expect(result).toEqual({ data: { storagePath: 'u/p/thumbnail.webp' }, error: null });
    });

    it('omits the Authorization header when there is no session', async () => {
        mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
        fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        await invokeFunction(FN, {});

        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('errors when VITE_API_URL is not set (required — no fallback exists)', async () => {
        vi.stubEnv('VITE_API_URL', '');

        const result = await invokeFunction(FN, {});

        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.data).toBeNull();
        expect(result.error?.message).toMatch(/VITE_API_URL/);
    });

    it('returns FunctionsHttpError with the response on .context for non-2xx', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

        const result = await invokeFunction(FN, {});

        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(FunctionsHttpError);
        expect((result.error as FunctionsHttpError).context.status).toBe(500);
    });

    it('returns FunctionsFetchError when the request fails at the network level', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));

        const result = await invokeFunction(FN, {});

        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(FunctionsFetchError);
    });

    it('funnels a 401 through the shared unauthorized handler', async () => {
        const onUnauthorized = vi.fn();
        setUnauthorizedHandler(onUnauthorized);
        fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));

        const result = await invokeFunction(FN, {});

        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(FunctionsHttpError);
        // The handler fires on a microtask, not inline with the response
        await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    });
});
