import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
    supabase: {
        functions: { invoke: vi.fn() },
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

import { invokeFunction, MIGRATED_FUNCTIONS } from './client';
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
    mocks.supabase.functions.invoke.mockResolvedValue({ data: { via: 'supabase' }, error: null });
    setUnauthorizedHandler(vi.fn());
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    MIGRATED_FUNCTIONS.delete(FN);
});

describe('invokeFunction routing', () => {
    it('falls through to supabase.functions.invoke when the flag is off (default)', async () => {
        MIGRATED_FUNCTIONS.add(FN);

        const result = await invokeFunction(FN, { a: 1 });

        expect(mocks.supabase.functions.invoke).toHaveBeenCalledExactlyOnceWith(FN, { body: { a: 1 } });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result).toEqual({ data: { via: 'supabase' }, error: null });
    });

    it('falls through to supabase when the flag is on but the function is not registered', async () => {
        vi.stubEnv('VITE_USE_SERVER', 'true');

        const result = await invokeFunction(FN, { a: 1 });

        expect(mocks.supabase.functions.invoke).toHaveBeenCalledExactlyOnceWith(FN, { body: { a: 1 } });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result).toEqual({ data: { via: 'supabase' }, error: null });
    });

    it('routes to the server when the flag is on and the function is registered', async () => {
        vi.stubEnv('VITE_USE_SERVER', 'true');
        MIGRATED_FUNCTIONS.add(FN);
        fetchMock.mockResolvedValue(jsonResponse({ via: 'server' }));

        const result = await invokeFunction(FN, { a: 1 });

        expect(mocks.supabase.functions.invoke).not.toHaveBeenCalled();
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

    it('omits the Authorization header when there is no session', async () => {
        vi.stubEnv('VITE_USE_SERVER', 'true');
        MIGRATED_FUNCTIONS.add(FN);
        mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
        fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        await invokeFunction(FN, {});

        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('errors instead of routing when the flag is on but VITE_API_URL is not set', async () => {
        vi.stubEnv('VITE_USE_SERVER', 'true');
        vi.stubEnv('VITE_API_URL', '');
        MIGRATED_FUNCTIONS.add(FN);

        const result = await invokeFunction(FN, {});

        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.supabase.functions.invoke).not.toHaveBeenCalled();
        expect(result.data).toBeNull();
        expect(result.error?.message).toMatch(/VITE_API_URL/);
    });
});

describe('invokeFunction server errors', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_USE_SERVER', 'true');
        MIGRATED_FUNCTIONS.add(FN);
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
