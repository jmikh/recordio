/**
 * Auth plugin (plan Step 1) — ports _shared/auth.ts.
 *
 * `requireUser` validates the `Authorization: Bearer` JWT locally — no
 * network roundtrip to Supabase per request, unlike the edge functions'
 * `auth.getUser()`. Trade-off: a revoked session stays valid until its 1h
 * expiry.
 *
 * Two token formats, chosen by the token's own header:
 * - HS256 — legacy shared secret (SUPABASE_JWT_SECRET)
 * - ES256/RS256 — the newer Supabase "JWT signing keys"; verified against
 *   the project's public JWKS (`/auth/v1/.well-known/jwks.json`), fetched
 *   once and cached by jose, not per request.
 *
 * Signature validity alone is NOT enough: the Supabase anon key (and service
 * role key) are JWTs signed with the same HS256 secret. A user token must
 * also carry `sub` and `role: 'authenticated'`.
 *
 * Stripe/Mux webhook signature preHandlers land with their webhook routes
 * (Wave D) — verification itself is already behind StripePort/MuxPort.
 */
import fp from 'fastify-plugin';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

export interface AuthUser {
    id: string;
    email?: string;
    userMetadata: Record<string, unknown>;
}

declare module 'fastify' {
    interface FastifyInstance {
        /** preHandler: 401 unless a valid Supabase user JWT is presented */
        requireUser: preHandlerAsyncHookHandler;
    }
    interface FastifyRequest {
        /** Set by requireUser */
        user?: AuthUser;
    }
}

export interface AuthPluginOptions {
    /** Legacy HS256 shared secret */
    supabaseJwtSecret?: string;
    /** Project URL — enables ES256/RS256 verification via its JWKS */
    supabaseUrl?: string;
}

/** Same shape/status the edge functions return, so the client's 401 handler keeps working. */
function unauthorized(reply: FastifyReply) {
    return reply.code(401).send({ error: 'Unauthorized' });
}

export const authPlugin = fp<AuthPluginOptions>(async (app, opts) => {
    const hsKey = opts.supabaseJwtSecret
        ? new TextEncoder().encode(opts.supabaseJwtSecret)
        : undefined;
    const jwks = opts.supabaseUrl
        ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', opts.supabaseUrl))
        : undefined;

    app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return unauthorized(reply);
        const token = header.slice('Bearer '.length);

        let payload: Record<string, unknown>;
        try {
            const { alg } = decodeProtectedHeader(token);
            if (alg === 'HS256') {
                if (!hsKey) throw new Error('SUPABASE_JWT_SECRET not configured');
                payload = (await jwtVerify(token, hsKey, { algorithms: ['HS256'] })).payload;
            } else {
                if (!jwks) throw new Error('SUPABASE_URL not configured for JWKS');
                payload = (await jwtVerify(token, jwks, { algorithms: ['ES256', 'RS256'] })).payload;
            }
        } catch {
            return unauthorized(reply);
        }
        // Reject non-user tokens signed with the same secret (anon/service role)
        if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') {
            return unauthorized(reply);
        }

        req.userId = payload.sub;
        req.user = {
            id: payload.sub,
            email: typeof payload.email === 'string' ? payload.email : undefined,
            userMetadata: (payload.user_metadata as Record<string, unknown>) ?? {},
        };
    });
}, { name: 'auth' });

/**
 * preHandler factory for machine-to-machine routes (render-worker callback,
 * welcome-email trigger): a constant-time check of `Authorization: Bearer <secret>`.
 */
export function requireServiceBearer(secret: string): preHandlerAsyncHookHandler {
    return async (req, reply) => {
        const header = req.headers.authorization ?? '';
        const expected = `Bearer ${secret}`;
        const a = Buffer.from(header);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return unauthorized(reply);
        }
    };
}
