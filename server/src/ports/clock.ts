/** Injectable clock — makes expiry/stale-job logic deterministic in tests. */
export interface Clock {
    now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
