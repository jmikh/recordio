import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const EnvSchema = Type.Object({
    PORT: Type.Number({ default: 8080 }),
    NODE_ENV: Type.String({ default: 'development' }),
    /** Supavisor pooled connection string (transaction mode). Local dev: the `supabase start` Postgres. */
    DATABASE_URL: Type.String({ minLength: 1 }),
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
        console.error('Invalid environment variables:');
        for (const issue of Value.Errors(EnvSchema, candidate)) {
            console.error(`  ${issue.path}: ${issue.message}`);
        }
        process.exit(1);
    }
    return candidate;
}
