/**
 * HS256 test tokens for unit tests — the same shapes Supabase issues.
 * Contract tests use real Supabase-issued tokens instead (see
 * *.contract.test.ts).
 */
import { SignJWT } from 'jose';

export const TEST_JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';

export function signToken(
    payload: Record<string, unknown>,
    secret = TEST_JWT_SECRET,
    expSeconds = 3600,
) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
        .sign(new TextEncoder().encode(secret));
}

export function userToken(overrides: Record<string, unknown> = {}, secret = TEST_JWT_SECRET) {
    return signToken(
        {
            sub: 'user-1',
            role: 'authenticated',
            email: 'user@example.com',
            user_metadata: {},
            ...overrides,
        },
        secret,
    );
}
