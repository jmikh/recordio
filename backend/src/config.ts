import { z } from 'zod';

const envSchema = z.object({
    PORT: z.coerce.number().default(3000),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    CORS_ORIGIN: z.string().min(1),
    MONTHLY_MINUTES_LIMIT: z.coerce.number().positive().default(60),
});

function loadConfig() {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error('Invalid environment variables:');
        for (const issue of result.error.issues) {
            console.error(`  ${issue.path.join('.')}: ${issue.message}`);
        }
        process.exit(1);
    }
    return result.data;
}

export const config = loadConfig();
