/**
 * POST /trial-extend — the one self-serve trial extension (billing
 * revamp Step 3,
 * plans/workspace-billing-revamp/workspace-billing-revamp-step-3.md).
 *
 * Owner-only. Grants trial_ends_at = now + 7 days (literally from the
 * extension date) and increments trial_extension_count in ONE guarded
 * UPDATE — eligibility lives in the WHERE clause (trial already ended,
 * extension unused, never-pro: any subscriptions row refuses, canceled
 * included — the one-way door), so double-clicks and concurrent
 * requests can never double-grant. The extension timestamp is the app
 * clock, not SQL now(), so the fake clock governs in tests.
 *
 * Request:  { workspaceId }
 * Response: { entitlements }            — state is now 'trial'
 *         | 404/403 { error }           — unknown workspace / not owner
 *         | 409 { error, reason }       — ever_pro | already_extended
 *                                         | trial_active (telemetry;
 *                                         the client just re-syncs)
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { TrialExtendRequestSchema } from '@shared/api/session';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const trialExtendRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/trial-extend',
        {
            preHandler: app.requireUser,
            schema: {
                body: TrialExtendRequestSchema,
            },
        },
        async (req, reply) => {
            const { workspaceId } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'workspace.id': workspaceId });

            const now = app.deps.clock.now();
            const { rowCount } = await app.deps.db.query(
                `UPDATE workspaces w
                 SET trial_ends_at = $3::timestamptz + interval '7 days',
                     trial_extension_count = w.trial_extension_count + 1,
                     updated_at = now()
                 WHERE w.id = $1 AND w.deleted_at IS NULL
                   AND w.owner_id = $2
                   AND w.trial_extension_count = 0
                   AND w.trial_ends_at <= $3
                   AND NOT EXISTS (
                       SELECT 1 FROM subscriptions s WHERE s.workspace_id = w.id
                   )`,
                [workspaceId, userId, now.toISOString()],
            );

            if ((rowCount ?? 0) === 0) {
                // Rare path — read back to tell WHY the guard refused.
                const { rows } = await app.deps.db.query(
                    `SELECT w.owner_id, w.trial_ends_at, w.trial_extension_count,
                            EXISTS (
                                SELECT 1 FROM subscriptions s WHERE s.workspace_id = w.id
                            ) AS ever_pro
                     FROM workspaces w
                     WHERE w.id = $1 AND w.deleted_at IS NULL`,
                    [workspaceId],
                );
                const ws = rows[0] as
                    | {
                          owner_id: string;
                          trial_ends_at: Date | string;
                          trial_extension_count: number;
                          ever_pro: boolean;
                      }
                    | undefined;

                if (!ws) {
                    return reply.code(404).send({ error: 'Workspace not found' });
                }
                if (ws.owner_id !== userId) {
                    return reply
                        .code(403)
                        .send({ error: 'Only the workspace owner can extend the trial' });
                }
                const reason = ws.ever_pro
                    ? 'ever_pro'
                    : ws.trial_extension_count > 0
                      ? 'already_extended'
                      : 'trial_active';
                return reply.code(409).send({ error: 'Trial extension not available', reason });
            }

            const entitlements = await getWorkspaceEntitlements(
                app.deps.db,
                app.deps.clock,
                workspaceId,
            );
            return reply.send({ entitlements });
        },
    );
};
