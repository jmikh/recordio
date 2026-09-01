/**
 * Entitlements derivation (billing revamp Steps 1–3) — pure-function
 * matrix pins: subscription status × trial date → state, and state →
 * capability flags. Any subscription row (status non-null) pins non-pro
 * statuses to free — the one-way door: a workspace that has ever been
 * pro never derives trial again. canExtendTrial (Step 3) only ever
 * surfaces on free. The DB read path (including canExtendTrial's
 * expired-unused-never-pro derivation) is covered by the gated-route,
 * subscription-get, and trial-extend e2e suites.
 */
import { describe, expect, it } from 'vitest';
import {
    deriveEntitlementsState,
    entitlementsForState,
    FREE_PROJECT_CAP,
} from '../src/services/entitlements.js';

const NOW = new Date('2026-09-01T12:00:00Z');
const FUTURE = new Date('2026-09-05T12:00:00Z');
const PAST = new Date('2026-08-01T12:00:00Z');

describe('deriveEntitlementsState', () => {
    it.each(['active', 'past_due', 'trialing'])('subscription %s → pro', (status) => {
        expect(deriveEntitlementsState(status, null, NOW)).toBe('pro');
    });

    it.each(['canceled', 'inactive', 'incomplete', 'unpaid'])(
        'subscription %s → free even with a live trial (one-way door)',
        (status) => {
            expect(deriveEntitlementsState(status, FUTURE, NOW)).toBe('free');
            expect(deriveEntitlementsState(status, PAST, NOW)).toBe('free');
            expect(deriveEntitlementsState(status, null, NOW)).toBe('free');
        },
    );

    it('no subscription + future trial → trial', () => {
        expect(deriveEntitlementsState(null, FUTURE, NOW)).toBe('trial');
    });

    it('no subscription + expired or absent trial → free', () => {
        expect(deriveEntitlementsState(null, PAST, NOW)).toBe('free');
        expect(deriveEntitlementsState(null, null, NOW)).toBe('free');
    });

    it('an active subscription wins over a live trial', () => {
        expect(deriveEntitlementsState('active', FUTURE, NOW)).toBe('pro');
    });
});

describe('entitlementsForState', () => {
    it('free: everything locked, project cap applied', () => {
        expect(entitlementsForState('free')).toEqual({
            state: 'free',
            canShare: false,
            canTranscribe: false,
            canBackgroundExport: false,
            can4k: false,
            canInvite: false,
            projectCap: FREE_PROJECT_CAP,
            trialEndsAt: null,
            canExtendTrial: false,
        });
    });

    it('trial: features unlocked, collaboration stays locked (trials are solo)', () => {
        expect(entitlementsForState('trial', FUTURE)).toEqual({
            state: 'trial',
            canShare: true,
            canTranscribe: true,
            canBackgroundExport: true,
            can4k: true,
            canInvite: false,
            projectCap: null,
            trialEndsAt: FUTURE.toISOString(),
            canExtendTrial: false,
        });
    });

    it('pro: everything unlocked, no trial date exposed', () => {
        expect(entitlementsForState('pro', FUTURE)).toEqual({
            state: 'pro',
            canShare: true,
            canTranscribe: true,
            canBackgroundExport: true,
            can4k: true,
            canInvite: true,
            projectCap: null,
            trialEndsAt: null,
            canExtendTrial: false,
        });
    });

    it('canExtendTrial passes through on free…', () => {
        expect(entitlementsForState('free', PAST, true)).toMatchObject({
            state: 'free',
            canExtendTrial: true,
        });
    });

    it('…but never on trial or pro (Step 3: the offer is post-lapse only)', () => {
        expect(entitlementsForState('trial', FUTURE, true).canExtendTrial).toBe(false);
        expect(entitlementsForState('pro', null, true).canExtendTrial).toBe(false);
    });
});
