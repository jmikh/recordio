import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { registerCors } from './plugins/cors.js';
import { transcribeRoute } from './transcription/route.js';

const app = Fastify({
    logger: {
        level: 'info',
        transport: process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
            : undefined,
    },
});

// Plugins
await registerCors(app);
await app.register(multipart);

// Routes
await app.register(transcribeRoute);

// Health check
app.get('/health', async () => ({ status: 'ok' }));

// Start
try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${config.PORT}`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
