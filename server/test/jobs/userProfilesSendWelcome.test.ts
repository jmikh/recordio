/**
 * Job `user_profiles.send-welcome` — e2e against the real local
 * Postgres, fake email; the job function is called directly (no
 * scheduler).
 *
 * LOCAL-DATA SAFETY: the job matches globally (`created_at` in the
 * 24–72h window, `welcome_email_sent_at IS NULL`) and this pool points
 * at the shared, long-lived local dev DB. The fake clock is pinned to
 * 2000-01-01, so the window (1999-12-29 → 1999-12-31) predates the
 * product — no real row can ever match; only this suite's backdated
 * seeds do. Do not move the clock forward.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { userProfilesSendWelcome } from '../../src/jobs/userProfilesSendWelcome.js';
import { WELCOME_EMAIL_SUBJECT } from '../../src/emails/welcomeEmail.js';
import { createFakeDeps, type FakeDeps } from '../fakes/index.js';
import { createTestPool, deleteAuthUsers, hasTestDb, seedAuthUser } from '../helpers/db.js';

const CLOCK_START = new Date('2000-01-01T00:00:00.000Z');
/** Inside the 24–72h window relative to CLOCK_START */
const IN_WINDOW = '1999-12-30T12:00:00.000Z';
/** Less than 24h old — not eligible yet */
const TOO_RECENT = '1999-12-31T12:00:00.000Z';
/** Older than the 72h backstop — never emailed */
const TOO_OLD = '1999-12-28T00:00:00.000Z';

const warnings: object[] = [];
const log = { warn: (obj: object) => void warnings.push(obj) };

describe.runIf(hasTestDb())('jobs/userProfilesSendWelcome (e2e, real Postgres)', () => {
    let pool: pg.Pool;
    const createdUsers: string[] = [];

    beforeAll(() => {
        pool = createTestPool();
    });
    afterEach(async () => {
        await deleteAuthUsers(pool, createdUsers);
        createdUsers.length = 0;
        warnings.length = 0;
    });
    afterAll(async () => {
        await pool.end();
    });

    function testDeps(): FakeDeps {
        const deps = createFakeDeps({ db: pool });
        deps.clock.set(CLOCK_START);
        return deps;
    }

    async function seedUser(createdAt: string) {
        const user = await seedAuthUser(pool);
        createdUsers.push(user.id);
        await pool.query('UPDATE user_profiles SET created_at = $1 WHERE user_id = $2', [
            createdAt,
            user.id,
        ]);
        return user;
    }

    async function sentAt(userId: string): Promise<string | null> {
        const { rows } = await pool.query(
            'SELECT welcome_email_sent_at FROM user_profiles WHERE user_id = $1',
            [userId],
        );
        return (rows[0] as { welcome_email_sent_at: string | null }).welcome_email_sent_at;
    }

    it('sends the welcome email to a previous-day signup and marks the profile', async () => {
        const deps = testDeps();
        const user = await seedUser(IN_WINDOW);

        const result = await userProfilesSendWelcome(deps, log);

        expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
        expect(deps.email.sent).toHaveLength(1);
        expect(deps.email.sent[0].to).toBe(user.email);
        expect(deps.email.sent[0].subject).toBe(WELCOME_EMAIL_SUBJECT);
        expect(deps.email.sent[0].html).toContain('Welcome to Recordio');
        expect(await sentAt(user.id)).not.toBeNull();
    });

    it('ignores profiles outside the window and already-marked ones', async () => {
        const deps = testDeps();
        const recent = await seedUser(TOO_RECENT);
        const ancient = await seedUser(TOO_OLD);
        const alreadySent = await seedUser(IN_WINDOW);
        await pool.query(
            'UPDATE user_profiles SET welcome_email_sent_at = NOW() WHERE user_id = $1',
            [alreadySent.id],
        );

        const result = await userProfilesSendWelcome(deps, log);

        expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
        expect(deps.email.sent).toHaveLength(0);
        expect(await sentAt(recent.id)).toBeNull();
        expect(await sentAt(ancient.id)).toBeNull();
    });

    it('a re-run (deploy startup tick) does not send twice', async () => {
        const deps = testDeps();
        await seedUser(IN_WINDOW);

        await userProfilesSendWelcome(deps, log);
        const second = await userProfilesSendWelcome(deps, log);

        expect(second).toEqual({ processed: 0, sent: 0, failed: 0 });
        expect(deps.email.sent).toHaveLength(1);
    });

    it('a failed send unclaims the profile so the next run retries it', async () => {
        const deps = testDeps();
        const user = await seedUser(IN_WINDOW);
        deps.email.nextResult = { success: false, error: 'resend down' };

        const first = await userProfilesSendWelcome(deps, log);
        expect(first).toEqual({ processed: 1, sent: 0, failed: 1 });
        expect(await sentAt(user.id)).toBeNull();
        expect(warnings).toHaveLength(1);

        deps.email.nextResult = { success: true };
        const second = await userProfilesSendWelcome(deps, log);
        expect(second).toEqual({ processed: 1, sent: 1, failed: 0 });
        expect(await sentAt(user.id)).not.toBeNull();
    });

    it('a user without an email is marked handled without a send', async () => {
        const deps = testDeps();
        const user = await seedUser(IN_WINDOW);
        await pool.query('UPDATE auth.users SET email = NULL WHERE id = $1', [user.id]);

        const result = await userProfilesSendWelcome(deps, log);

        expect(result).toEqual({ processed: 1, sent: 0, failed: 0 });
        expect(deps.email.sent).toHaveLength(0);
        expect(await sentAt(user.id)).not.toBeNull();
        expect(warnings).toHaveLength(1);
    });
});
