import { z } from 'zod';

const envSchema = z.object({
    PORT: z.coerce.number().default(8080),
    RENDER_SECRET: z.string().min(1),
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
