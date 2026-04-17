import type { FastifyInstance } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { transcribeAudio } from './openai.js';
import { checkAndReserve, rollback } from './rateLimit.js';
import { RateLimitError } from './types.js';
import type { TranscribeResponse } from './types.js';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

export async function transcribeRoute(app: FastifyInstance) {
    app.post('/transcribe', async (request, reply) => {
        // Authenticate and verify pro access
        const user = await authenticateRequest(request, reply);
        if (!user) return; // reply already sent

        // Parse multipart
        let audioBuffer: Buffer;
        let mimeType = 'audio/webm';
        let language = 'en';
        let durationSeconds = 0;

        try {
            const parts = request.parts({ limits: { fileSize: MAX_FILE_SIZE } });
            for await (const part of parts) {
                if (part.type === 'file' && part.fieldname === 'audio') {
                    mimeType = part.mimetype || 'audio/webm';
                    const chunks: Buffer[] = [];
                    for await (const chunk of part.file) {
                        chunks.push(chunk);
                    }
                    audioBuffer = Buffer.concat(chunks);

                    if (part.file.truncated) {
                        reply.code(400).send({ error: 'file_too_large', message: `Audio file exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` });
                        return;
                    }
                } else if (part.type === 'field') {
                    if (part.fieldname === 'language' && typeof part.value === 'string') {
                        language = part.value;
                    } else if (part.fieldname === 'durationSeconds' && typeof part.value === 'string') {
                        durationSeconds = parseFloat(part.value) || 0;
                    }
                }
            }
        } catch (err) {
            request.log.error({ err }, 'Failed to parse multipart');
            reply.code(400).send({ error: 'bad_request', message: 'Failed to parse multipart body' });
            return;
        }

        if (!audioBuffer!) {
            reply.code(400).send({ error: 'bad_request', message: 'Missing audio field' });
            return;
        }

        if (durationSeconds <= 0) {
            reply.code(400).send({ error: 'bad_request', message: 'Missing or invalid durationSeconds field' });
            return;
        }

        const requestedMinutes = Math.ceil(durationSeconds / 6) / 10; // Round up to nearest 0.1 min

        // Check rate limit and reserve
        let cycleMinutesUsed: number;
        let cycleMinutesLimit: number;
        let cycleResetDate: Date;
        try {
            const result = await checkAndReserve(user, requestedMinutes);
            cycleMinutesUsed = result.cycleMinutesUsed;
            cycleMinutesLimit = result.cycleMinutesLimit;
            cycleResetDate = result.cycleResetDate;
        } catch (err) {
            if (err instanceof RateLimitError) {
                reply.code(429).send({
                    error: 'rate_limit_exceeded',
                    message: 'Monthly transcription limit reached',
                    cycleMinutesUsed: err.minutesUsed,
                    cycleMinutesLimit: err.minutesLimit,
                    resetsAt: err.resetsAt.toISOString(),
                });
                return;
            }
            throw err;
        }

        // Call OpenAI Whisper API
        let segments;
        try {
            segments = await transcribeAudio(audioBuffer, mimeType, language);
        } catch (err) {
            request.log.error({ err }, 'OpenAI transcription failed');
            // Roll back usage on failure
            await rollback(user.userId, requestedMinutes);
            reply.code(502).send({ error: 'transcription_failed', message: 'Transcription service failed' });
            return;
        }

        const response: TranscribeResponse = {
            segments,
            minutesUsed: requestedMinutes,
            cycleMinutesUsed,
            cycleMinutesLimit,
            cycleResetsAt: cycleResetDate.toISOString(),
        };

        reply.send(response);
    });
}
