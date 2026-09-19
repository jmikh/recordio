/**
 * canAttemptPublish — the two-counter budget that bounds the render
 * shared-video-get dispatches on behalf of any viewer, anonymous
 * included. Pure, so no database: the "is it inside the cooldown"
 * comparison is made in SQL by the caller (both updated_at columns are
 * written with the database's NOW(), so the app clock must not be the
 * one measuring them) and arrives here as a boolean.
 */
import { describe, expect, it } from 'vitest';
import {
    canAttemptPublish,
    MAX_PUBLISH_ATTEMPTS,
    type PublishAttemptState,
} from '../src/services/sharedVideoPublish.js';

/** No rows at all — a project that has never been published. */
const FRESH: PublishAttemptState = {
    muxAttempt: null,
    muxRecent: null,
    renderAttemptCount: null,
    renderRecent: null,
};

const spent = (over: Partial<PublishAttemptState> = {}): PublishAttemptState => ({
    muxAttempt: MAX_PUBLISH_ATTEMPTS,
    muxRecent: true,
    renderAttemptCount: MAX_PUBLISH_ATTEMPTS,
    renderRecent: true,
    ...over,
});

describe('canAttemptPublish', () => {
    it('allows a first publish when neither row exists', () => {
        expect(canAttemptPublish(FRESH)).toBe(true);
    });

    it('allows every attempt below the ceiling', () => {
        for (let n = 1; n < MAX_PUBLISH_ATTEMPTS; n++) {
            expect(canAttemptPublish({
                muxAttempt: n, muxRecent: true, renderAttemptCount: n, renderRecent: true,
            })).toBe(true);
        }
    });

    it('blocks at the ceiling while both rows are inside the cooldown', () => {
        expect(canAttemptPublish(spent())).toBe(false);
    });

    it('blocks when only the RENDER counter is spent', () => {
        // The ordinary case: a render that keeps failing
        expect(canAttemptPublish(spent({ muxAttempt: 1, muxRecent: true }))).toBe(false);
    });

    it('blocks when only the MUX counter is spent', () => {
        // asset.errored with a cached render — attempt_count never moves,
        // so this is the only counter that can stop the re-upload loop
        expect(canAttemptPublish(spent({ renderAttemptCount: 1, renderRecent: true }))).toBe(false);
    });

    it('allows one more once the cooldown has passed on both', () => {
        expect(canAttemptPublish(spent({ muxRecent: false, renderRecent: false }))).toBe(true);
    });

    it('still blocks when only one row has cooled down', () => {
        expect(canAttemptPublish(spent({ renderRecent: false }))).toBe(false);
        expect(canAttemptPublish(spent({ muxRecent: false }))).toBe(false);
    });

    it('a counter at the ceiling with no row (null recent) does not block', () => {
        // Unreachable in practice — an attempt count implies a row — but
        // the predicate must not treat "unknown" as "recent"
        expect(canAttemptPublish({ ...FRESH, muxAttempt: MAX_PUBLISH_ATTEMPTS })).toBe(true);
    });

    it('blocks past the ceiling, not only exactly at it', () => {
        expect(canAttemptPublish(spent({ renderAttemptCount: MAX_PUBLISH_ATTEMPTS + 3 }))).toBe(false);
    });
});
