/**
 * POST /mux-video-webhook — ports the `mux-video-hook` edge function
 * (Wave D #16; server route says "webhook" per the naming decision —
 * only the edge fn keeps "hook").
 *
 * Called by Mux on video.asset.* events. Auth is the Mux webhook
 * signature (`mux-signature: t=<ts>,v1=<hex>`, HMAC-SHA256 over
 * `${timestamp}.${rawBody}`) — verified by the mux port against the
 * RAW request bytes, so this plugin registers a SCOPED content-type
 * parser that keeps the body as a string (Fastify encapsulation keeps
 * it from leaking to other routes). No body schema: the raw string is
 * the body, and the edge fn validated nothing.
 *
 * Flow (parity): missing header → 401 → bad signature → 401 (the edge
 * fn's separate `Invalid signature format` body collapses into
 * `Invalid signature` — documented divergence, Mux reads no bodies) →
 * JSON.parse → missing data.id → 200 acknowledged →
 *   video.asset.ready   → inline complete-UPDATE over the pool
 *                         (EXCLUSIVE to this webhook, explicit params,
 *                         no auth.uid() → stays SQL). Matches ANY
 *                         status; found=false → 200 + message, warn.
 *                         No playback id → THROW (500 — Mux retries).
 *   video.asset.errored → mark the PENDING row for the asset failed
 *                         with the joined messages (`Unknown Mux
 *                         error` default); no row → still 200.
 *   anything else       → 200 acknowledged (prevents retries).
 *
 * Response: { ok: true, message? }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

interface MuxWebhookEvent {
    type?: string;
    data?: {
        id?: string;
        playback_ids?: Array<{ id?: string }>;
        errors?: { messages?: string[] };
    };
}

interface CompleteRow {
    mux_video_id: string;
    project_id: string;
}

export const muxVideoWebhookRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Raw body for signature verification — scoped to this plugin's
    // encapsulation context; every other route keeps parsed JSON
    // (pinned by test)
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
    });

    app.post(
        '/mux-video-webhook',
        {
            schema: {
                response: {
                    200: Type.Object({
                        ok: Type.Literal(true),
                        message: Type.Optional(Type.String()),
                    }),
                    401: Type.Object({ error: Type.String() }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const signature = req.headers['mux-signature'];
            if (typeof signature !== 'string') {
                return reply.code(401).send({ error: 'Missing mux-signature header' });
            }

            const rawBody = req.body as string;
            if (!app.deps.mux.verifyWebhookSignature(rawBody, signature)) {
                req.logCtx.set({ error_type: 'MuxSignatureInvalid' });
                return reply.code(401).send({ error: 'Invalid signature' });
            }

            const event = JSON.parse(rawBody) as MuxWebhookEvent;
            const eventType = event.type;
            const assetId = event.data?.id;

            if (!assetId) {
                return { ok: true as const, message: 'No asset ID, ignoring' };
            }
            req.logCtx.set({ 'mux.asset_id': assetId });

            if (eventType === 'video.asset.ready') {
                const playbackId = event.data?.playback_ids?.[0]?.id;
                if (!playbackId) {
                    // 500 on purpose — Mux retries until the playback id shows up
                    throw new Error(`asset.ready but no playback_id for asset ${assetId}`);
                }

                // Inline port of mux_video_complete (SQL fn graveyarded
                // 2026-07-25): one UPDATE…RETURNING; zero rows = the old
                // found:false. Matches by asset id in ANY status (a
                // replayed asset.ready revives a canceled/failed row —
                // known smell, parity) and updates ONE row via the
                // LIMIT 1 subquery (the fn's SELECT INTO took one row;
                // idx on mux_asset_id is non-unique).
                const { rows } = await app.deps.db.query(
                    `UPDATE mux_videos
                     SET status = 'completed', mux_playback_id = $2, updated_at = NOW()
                     WHERE id = (SELECT id FROM mux_videos WHERE mux_asset_id = $1 LIMIT 1)
                     RETURNING id AS mux_video_id, project_id`,
                    [assetId, playbackId],
                );
                const result = rows[0] as CompleteRow | undefined;

                if (!result) {
                    req.log.warn({ 'mux.asset_id': assetId }, 'no mux_video for ready asset');
                    return { ok: true as const, message: 'No matching pending row' };
                }

                req.logCtx.set({
                    'mux.video_status': 'completed',
                    'project.id': result.project_id,
                });
                return { ok: true as const };
            }

            if (eventType === 'video.asset.errored') {
                // `??` not `||` — an empty messages array joins to '' and is
                // stored as-is (edge-fn parity)
                const errorMessages = event.data?.errors?.messages?.join('; ') ?? 'Unknown Mux error';

                const { rows } = await app.deps.db.query(
                    "SELECT id FROM mux_videos WHERE mux_asset_id = $1 AND status = 'pending' LIMIT 1",
                    [assetId],
                );
                const muxVideo = rows[0] as { id: string } | undefined;

                if (muxVideo) {
                    await app.deps.db.query(
                        'UPDATE mux_videos SET status = $2, error = $3, updated_at = $4 WHERE id = $1',
                        [muxVideo.id, 'failed', errorMessages, app.deps.clock.now().toISOString()],
                    );
                    req.logCtx.set({ 'mux.video_status': 'failed' });
                }

                return { ok: true as const };
            }

            // Unhandled event — acknowledge to prevent retries
            return { ok: true as const, message: `Ignored event: ${eventType}` };
        },
    );
};
