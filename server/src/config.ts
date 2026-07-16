import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const EnvSchema = Type.Object({
    PORT: Type.Number({ default: 8080 }),
    NODE_ENV: Type.String({ default: 'development' }),
    /** Supavisor pooled connection string (transaction mode). Local dev: the `supabase start` Postgres. */
    DATABASE_URL: Type.String({ minLength: 1 }),
    /** Supabase project URL — JWKS for ES256/RS256 user tokens, platform APIs later */
    SUPABASE_URL: Type.String({ minLength: 1 }),
    /** Legacy HS256 secret (dashboard → Project Settings → API → JWT Settings) */
    SUPABASE_JWT_SECRET: Type.String({ minLength: 1 }),
    /** Service-role key for Supabase platform APIs (auth admin user lookup, storage) */
    SUPABASE_SERVICE_ROLE_KEY: Type.String({ minLength: 1 }),
    /**
     * Stripe secret key + the four subscription price ids (same names as the
     * edge function secrets). Required — a deploy without Stripe config
     * should fail loudly, not degrade. Local: test-mode values.
     */
    STRIPE_SECRET_KEY: Type.String({ minLength: 1 }),
    STRIPE_PRO_PRICE_ID_MONTHLY: Type.String({ minLength: 1 }),
    STRIPE_PRO_PRICE_ID_YEARLY: Type.String({ minLength: 1 }),
    STRIPE_TEAMS_PRICE_ID_MONTHLY: Type.String({ minLength: 1 }),
    STRIPE_TEAMS_PRICE_ID_YEARLY: Type.String({ minLength: 1 }),
    SENTRY_DSN: Type.Optional(Type.String()),
    /** Set automatically by Railway; used as release/version tag. */
    RAILWAY_GIT_COMMIT_SHA: Type.Optional(Type.String()),
    /**
     * S3-compatible storage (project-media bucket) — same values the edge
     * functions use. Optional as a group: when any is missing the s3 port
     * stays unimplemented (fails loudly per call) instead of failing the
     * whole deploy.
     */
    S3_REGION: Type.Optional(Type.String()),
    S3_ENDPOINT: Type.Optional(Type.String()),
    S3_ACCESS_KEY: Type.Optional(Type.String()),
    S3_SECRET_KEY: Type.Optional(Type.String()),
});

export type Config = Static<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const candidate = Value.Clean(
        EnvSchema,
        Value.Default(EnvSchema, Value.Convert(EnvSchema, { ...env })),
    );
    if (!Value.Check(EnvSchema, candidate)) {
        // Startup-time only: the logger can't exist before config does
        // eslint-disable-next-line no-console
        console.error('Invalid environment variables:');
        for (const issue of Value.Errors(EnvSchema, candidate)) {
            // eslint-disable-next-line no-console
            console.error(`  ${issue.path}: ${issue.message}`);
        }
        process.exit(1);
    }
    return candidate;
}
