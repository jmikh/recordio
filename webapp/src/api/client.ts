import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { authAwareFetch, supabase } from '../supabase/client';

/**
 * Edge functions that have been ported to the Fastify server (Supabase →
 * Fastify migration, Part 1). invokeFunction routes to the server only for
 * names listed here AND when VITE_USE_SERVER === 'true' — cutover stays
 * per-function, and rollback is a flag flip. Each function is added in the
 * same change as its server port.
 */
export const MIGRATED_FUNCTIONS = new Set<string>([
    'storage-download-urls',
    'shared-video-get',
    'stripe-checkout',
    'stripe-portal',
    'subscription-change',
    'project-update-thumbnail',
    'asset-create',
    'project-create-v2',
    'render-job-create',
    'transcribe',
    'mux-video-create',
]);

export type InvokeResult<T> =
    | { data: T; error: null }
    | { data: null; error: Error };

/**
 * Drop-in replacement for `supabase.functions.invoke(name, { body })`,
 * returning the same `{ data, error }` shape (FunctionsHttpError with the
 * Response on `.context` for non-2xx, FunctionsFetchError on network
 * failure) so call sites keep their existing types when they convert.
 *
 * Server requests go through authAwareFetch, so a 401 from the Fastify
 * server funnels into the same unauthorized handler as supabase calls.
 */
export async function invokeFunction<T = unknown>(name: string, body?: unknown): Promise<InvokeResult<T>> {
    const useServer = import.meta.env.VITE_USE_SERVER === 'true' && MIGRATED_FUNCTIONS.has(name);

    if (!useServer) {
        if (!supabase) return { data: null, error: new Error('Supabase not configured') };
        return supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> });
    }

    const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
    if (!baseUrl) {
        return { data: null, error: new Error('VITE_USE_SERVER is on but VITE_API_URL is not set') };
    }

    // FormData passes through untouched with no Content-Type header —
    // the browser sets the multipart boundary (supabase.functions.invoke
    // handles FormData the same way on the fall-through path)
    const isFormData = body instanceof FormData;
    const headers: Record<string, string> = isFormData
        ? {}
        : { 'Content-Type': 'application/json' };
    if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) headers.Authorization = `Bearer ${session.access_token}`;
    }

    let response: Response;
    try {
        response = await authAwareFetch(`${baseUrl}/${name}`, {
            method: 'POST',
            headers,
            body: isFormData ? body : JSON.stringify(body ?? {}),
        });
    } catch (err) {
        return { data: null, error: new FunctionsFetchError(err) };
    }

    if (!response.ok) {
        return { data: null, error: new FunctionsHttpError(response) };
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
    return { data: data as T, error: null };
}
