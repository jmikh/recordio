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
    SENTRY_DSN: Type.Optional(Type.String()),
    /** Set automatically by Railway; used as release/version tag. */
    RAILWAY_GIT_COMMIT_SHA: Type.Optional(Type.String()),
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
