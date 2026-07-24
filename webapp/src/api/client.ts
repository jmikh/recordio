import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { authAwareFetch, notifyUnauthorized, supabase } from '../supabase/client';

export type InvokeResult<T> =
    | { data: T; error: null }
    | { data: null; error: Error };

/**
 * Calls the Fastify API server: POST `${VITE_API_URL}/${name}` with the
 * current session's bearer token. Server-only since the Step 5
 * decommission (2026-07-24) — the edge functions are deleted, and the
 * per-function VITE_USE_SERVER/MIGRATED_FUNCTIONS cutover machinery went
 * with them (git history has it).
 *
 * Returns the supabase-shaped `{ data, error }` (FunctionsHttpError with
 * the Response on `.context` for non-2xx, FunctionsFetchError on network
 * failure) so call sites keep the types they were written against.
 *
 * Requests go through authAwareFetch, so a 401 from the server funnels
 * into the same unauthorized handler as supabase calls.
 */
export async function invokeFunction<T = unknown>(name: string, body?: unknown): Promise<InvokeResult<T>> {
    const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
    if (!baseUrl) {
        return { data: null, error: new Error('VITE_API_URL is not set') };
    }

    // FormData passes through untouched with no Content-Type header —
    // the browser sets the multipart boundary
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

/**
 * Multipart-upload variant of invokeFunction. Uses XMLHttpRequest
 * because fetch cannot report request-body progress. Same
 * `{ data, error }` shape and the same 401 → sign-out funneling
 * (via notifyUnauthorized, since authAwareFetch can't wrap XHR).
 */
export async function invokeFunctionUpload<T = unknown>(
    name: string,
    form: FormData,
    onProgress?: (fraction: number) => void,
): Promise<InvokeResult<T>> {
    const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
    if (!baseUrl) {
        return { data: null, error: new Error('VITE_API_URL is not set') };
    }

    let token: string | undefined;
    if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) token = session.access_token;
    }

    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        // No Content-Type header — XHR sets the multipart boundary
        xhr.open('POST', `${baseUrl}/${name}`, true);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(e.loaded / e.total);
            };
        }

        xhr.onload = () => {
            if (xhr.status === 401) notifyUnauthorized();
            if (xhr.status < 200 || xhr.status >= 300) {
                resolve({
                    data: null,
                    error: new FunctionsHttpError(
                        new Response(xhr.responseText, { status: xhr.status }),
                    ),
                });
                return;
            }
            const contentType = xhr.getResponseHeader('Content-Type') ?? '';
            const data = contentType.includes('application/json')
                ? JSON.parse(xhr.responseText)
                : xhr.responseText;
            resolve({ data: data as T, error: null });
        };
        xhr.onerror = () => resolve({ data: null, error: new FunctionsFetchError(new Error('network error')) });
        xhr.onabort = () => resolve({ data: null, error: new FunctionsFetchError(new Error('upload aborted')) });

        xhr.send(form);
    });
}
