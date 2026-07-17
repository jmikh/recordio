/**
 * POST /transcribe — ports the edge function of the same name
 * (Wave B #8). First route using the TranscriptionPort (OpenAI
 * Whisper).
 *
 * `{ projectId }` → project lookup → workspace-membership +
 * subscription gate → mic download from S3 → Whisper → word-level
 * caption segments (punctuation restored from segment text, words
 * grouped into segments by a ±50 ms window).
 *
 * ACCESS CONTROL: there is no editor/owner check — the gate is "caller
 * is a member of the project's workspace AND that workspace has an
 * active|trialing subscription". The edge fn got this from the SHARED,
 * auth.uid()-dependent `subscription_get` RPC (still used directly by
 * the webapp — stays untouched); auth.uid() can't work over the pg
 * pool, so its membership JOIN is ported inline with explicit
 * $user_id. Non-member, no subscription, and wrong status all collapse
 * into the same 403 (parity; information hiding).
 *
 * Divergences (documented): schema 400 replaces the `Missing projectId`
 * body; the adapter aborts Whisper at 120 s (plan requirement — Railway
 * has no request ceiling; the edge runtime's was ~150 s) and throws on
 * non-2xx; the edge fn's `S3_ENDPOINT_DEV`-first split is dropped
 * (server-side download from the host).
 *
 * Request:  { projectId }
 * Response: { segments: [{ sourceStartTimeMs, sourceEndTimeMs,
 *              words: [{ word, sourceStartTimeMs, sourceEndTimeMs }] }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { getProjectMicPath } from '../services/projectMedia.js';

const MIME_MAP: Record<string, string> = {
    webm: 'audio/webm',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
};

export interface WordEntry {
    word: string;
    sourceStartTimeMs: number;
    sourceEndTimeMs: number;
}

/**
 * Whisper's word list is unpunctuated; its segment texts carry the
 * punctuation. Walk both in order and take the segment token whenever
 * it matches the word (verbatim port — heuristic quirks and all).
 */
export function addPunctuationFromSegments(words: WordEntry[], segmentTexts: string[]): WordEntry[] {
    const tokens: string[] = [];
    for (const text of segmentTexts) {
        for (const token of text.split(/\s+/)) {
            if (token) tokens.push(token);
        }
    }

    const result = words.map((w) => ({ ...w }));
    let tokenIdx = 0;

    for (const w of result) {
        if (tokenIdx >= tokens.length) break;
        const token = tokens[tokenIdx];
        const wordLower = w.word.toLowerCase();
        const tokenLower = token.toLowerCase();
        if (
            tokenLower.startsWith(wordLower) ||
            tokenLower.replace(/[^\w']/g, '') === wordLower.replace(/[^\w']/g, '')
        ) {
            w.word = token;
            tokenIdx++;
        } else {
            tokenIdx++;
        }
    }

    return result;
}

export interface SegmentWindow {
    start: number;
    end: number;
}

/**
 * Group words into segments by Whisper's segment windows (±50 ms
 * tolerance). Words outside every window are dropped; empty windows are
 * skipped (verbatim port).
 */
export function groupWordsIntoSegments(
    words: WordEntry[],
    windows: SegmentWindow[],
): { sourceStartTimeMs: number; sourceEndTimeMs: number; words: WordEntry[] }[] {
    const segments = [];
    for (const ws of windows) {
        const segWords = words.filter(
            (w) => w.sourceStartTimeMs >= ws.start - 50 && w.sourceEndTimeMs <= ws.end + 50,
        );
        if (segWords.length === 0) continue;
        segments.push({
            sourceStartTimeMs: segWords[0].sourceStartTimeMs,
            sourceEndTimeMs: segWords[segWords.length - 1].sourceEndTimeMs,
            words: segWords,
        });
    }
    return segments;
}

export const transcribeRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/transcribe',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({
                        segments: Type.Array(
                            Type.Object({
                                sourceStartTimeMs: Type.Number(),
                                sourceEndTimeMs: Type.Number(),
                                words: Type.Array(
                                    Type.Object({
                                        word: Type.String(),
                                        sourceStartTimeMs: Type.Number(),
                                        sourceEndTimeMs: Type.Number(),
                                    }),
                                ),
                            }),
                        ),
                    }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const { projectId } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'project.id': projectId });

            const { rows: projectRows } = await app.deps.db.query(
                `SELECT project_data, workspace_id FROM projects
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );
            const project = projectRows[0] as
                | { project_data: unknown; workspace_id: string }
                | undefined;
            if (!project) {
                return reply.code(404).send({ error: 'Project not found' });
            }

            // Inline port of subscription_get's membership + subscription
            // read — the JOIN is the endpoint's ONLY access control (see
            // header comment)
            const { rows: subRows } = await app.deps.db.query(
                `SELECT s.status FROM subscriptions s
                 JOIN workspace_members wm
                   ON wm.workspace_id = s.workspace_id AND wm.user_id = $2
                 WHERE s.workspace_id = $1`,
                [project.workspace_id, userId],
            );
            const status = (subRows[0] as { status: string } | undefined)?.status;
            if (status !== 'active' && status !== 'trialing') {
                return reply.code(403).send({ error: 'Active subscription required' });
            }

            const micPath = getProjectMicPath(project.project_data);
            if (!micPath) {
                return reply.code(400).send({ error: 'Project has no microphone audio' });
            }

            const bytes = await app.deps.s3.getObject(micPath);
            req.logCtx.set({ 'storage.bytes': bytes.byteLength });

            const ext = micPath.split('.').pop() ?? 'wav';
            const result = await app.deps.transcription.transcribe({
                bytes,
                fileName: `audio.${ext}`,
                mimeType: MIME_MAP[ext] ?? 'audio/wav',
            });

            const rawWords: WordEntry[] = result.words.map((w) => ({
                word: w.word,
                sourceStartTimeMs: Math.round(w.start * 1000),
                sourceEndTimeMs: Math.round(w.end * 1000),
            }));

            if (rawWords.length === 0) {
                return { segments: [] };
            }

            const punctuatedWords = addPunctuationFromSegments(
                rawWords,
                result.segments.map((s) => s.text.trim()),
            );
            const windows = result.segments.map((s) => ({
                start: Math.round(s.start * 1000),
                end: Math.round(s.end * 1000),
            }));

            return { segments: groupWordsIntoSegments(punctuatedWords, windows) };
        },
    );
};
