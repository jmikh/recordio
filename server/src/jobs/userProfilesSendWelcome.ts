/**
 * Job `user_profiles.send-welcome` (daily, notBeforeUtcHour 13 =
 * 8:00 EST / 9:00 EDT) — sends the welcome email to users whose profile
 * was created the previous day. Replaces the caller-less
 * POST /send-welcome-email route (its trigger chain died with
 * `trial_start()`, 2026-07-25; route deleted with this job).
 *
 * Window: created 24–72h before the run. Nominally "yesterday"; the
 * 72h backstop catches a day the job didn't run (scheduler down, gate
 * hour missed) without ever emailing older signups. No backfill:
 * profiles predating the welcome_email_sent_at migration fall outside
 * the window and are never selected.
 *
 * Send-safety (the scheduler re-runs jobs on every deploy): each row is
 * CLAIMED first via atomic UPDATE ... WHERE welcome_email_sent_at IS
 * NULL — a concurrent run gets rowCount 0 and skips. A failed send
 * clears the marker so the next run retries; if that clear itself
 * fails, the user misses the email — preferred over double-sending.
 */
import type { Deps } from '../deps.js';
import { buildWelcomeEmailHtml, WELCOME_EMAIL_SUBJECT } from '../emails/welcomeEmail.js';
import type { JobLogger } from './types.js';

export const WELCOME_SEND_BATCH_LIMIT = 100;

const HOUR_MS = 60 * 60 * 1000;

interface CandidateUser {
    user_id: string;
    email: string | null;
}

export interface UserProfilesSendWelcomeResult {
    processed: number;
    sent: number;
    failed: number;
}

export async function userProfilesSendWelcome(
    deps: Pick<Deps, 'db' | 'email' | 'clock'>,
    log: JobLogger,
): Promise<UserProfilesSendWelcomeResult> {
    const now = deps.clock.now().getTime();
    const newestEligible = new Date(now - 24 * HOUR_MS).toISOString();
    const oldestEligible = new Date(now - 72 * HOUR_MS).toISOString();

    const { rows } = await deps.db.query(
        `SELECT p.user_id, u.email
         FROM user_profiles p
         JOIN auth.users u ON u.id = p.user_id
         WHERE p.welcome_email_sent_at IS NULL
           AND p.created_at <= $1
           AND p.created_at >= $2
         ORDER BY p.created_at
         LIMIT ${WELCOME_SEND_BATCH_LIMIT}`,
        [newestEligible, oldestEligible],
    );
    const candidates = rows as CandidateUser[];

    let sent = 0;
    let failed = 0;

    for (const user of candidates) {
        if (!user.email) {
            // Unretryable — mark handled so the row stops matching
            await deps.db.query(
                'UPDATE user_profiles SET welcome_email_sent_at = NOW() WHERE user_id = $1',
                [user.user_id],
            );
            log.warn(
                { 'user.id': user.user_id },
                'user_profiles.send-welcome: no email on auth user, skipped',
            );
            continue;
        }

        const { rowCount } = await deps.db.query(
            `UPDATE user_profiles SET welcome_email_sent_at = NOW()
             WHERE user_id = $1 AND welcome_email_sent_at IS NULL`,
            [user.user_id],
        );
        if (!rowCount) continue; // claimed by a concurrent run

        try {
            const result = await deps.email.send({
                to: user.email,
                subject: WELCOME_EMAIL_SUBJECT,
                html: buildWelcomeEmailHtml(),
            });
            if (!result.success) throw new Error(`Resend send failed: ${result.error}`);
            sent++;
        } catch (err) {
            failed++;
            log.warn(
                { err, 'user.id': user.user_id },
                'user_profiles.send-welcome: send failed, unclaiming for retry next run',
            );
            await deps.db.query(
                'UPDATE user_profiles SET welcome_email_sent_at = NULL WHERE user_id = $1',
                [user.user_id],
            );
        }
    }

    return { processed: candidates.length, sent, failed };
}
