import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

export async function registerCors(app: FastifyInstance) {
    const origins = config.CORS_ORIGIN.split(',').map(o => o.trim());
    await app.register(cors, {
        origin: origins,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type'],
        credentials: true,
    });
}
