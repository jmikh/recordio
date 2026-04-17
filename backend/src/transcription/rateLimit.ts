import { supabase } from '../middleware/auth.js';
import { config } from '../config.js';
import { RateLimitError } from './types.js';
import type { AuthenticatedUser } from '../middleware/auth.js';

/**
 * Compute the current billing cycle's reset date.
 *
 * - Monthly plan: current_period_end is the next reset
 * - Yearly plan: derive a monthly window from the subscription anniversary day
 * - Trialing: current_period_end is the trial end (one cycle = full trial)
 */
function computeCycleResetDate(user: AuthenticatedUser): Date {
    const { currentPeriodEnd, billingInterval, subscriptionStatus } = user;

    // Trial: the whole trial is one cycle
    if (subscriptionStatus === 'trialing') {
        return currentPeriodEnd;
    }

    // Monthly (or lifetime treated as monthly): Stripe's period end is the reset
    if (billingInterval !== 'yearly') {
        return currentPeriodEnd;
    }

    // Yearly: derive monthly windows from the anniversary day.
    // The subscription anniversary day-of-month is the day in current_period_end.
    // Find the next occurrence of that day from today.
    const now = new Date();
    const anniversaryDay = currentPeriodEnd.getUTCDate();

    // Start from current month
    let resetDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        anniversaryDay
    ));

    // If reset date is in the past or today, move to next month
    if (resetDate <= now) {
        resetDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            anniversaryDay
        ));
    }

    // Clamp to not exceed the subscription's actual end
    if (resetDate > currentPeriodEnd) {
        resetDate = currentPeriodEnd;
    }

    return resetDate;
}

/**
 * Check usage and reserve minutes atomically.
 * Returns current cycle usage info on success.
 * Throws RateLimitError if the limit would be exceeded.
 */
export async function checkAndReserve(
    user: AuthenticatedUser,
    requestedMinutes: number
): Promise<{ cycleMinutesUsed: number; cycleMinutesLimit: number; cycleResetDate: Date }> {
    const cycleResetDate = computeCycleResetDate(user);
    const defaultLimit = config.MONTHLY_MINUTES_LIMIT;

    // Atomic upsert: insert or update, with lazy cycle reset
    // Default limit is only used when creating a new row; existing rows use their per-user limit.
    const { data, error } = await supabase.rpc('upsert_transcription_usage', {
        p_user_id: user.userId,
        p_minutes: requestedMinutes,
        p_reset_date: cycleResetDate.toISOString(),
        p_default_limit: defaultLimit,
    });

    if (error) {
        // Check if it's our custom rate limit error from the function
        if (error.message?.includes('rate_limit_exceeded')) {
            // Query current usage to report back
            const { data: usage } = await supabase
                .from('transcription_usage')
                .select('minutes_used, minutes_limit')
                .eq('user_id', user.userId)
                .single();

            throw new RateLimitError({
                minutesUsed: Number(usage?.minutes_used ?? 0),
                minutesLimit: Number(usage?.minutes_limit ?? defaultLimit),
                resetsAt: cycleResetDate,
            });
        }
        throw error;
    }

    return {
        cycleMinutesUsed: Number(data.minutes_used),
        cycleMinutesLimit: Number(data.minutes_limit),
        cycleResetDate,
    };
}

/**
 * Roll back usage on OpenAI API failure so failed requests don't consume quota.
 */
export async function rollback(userId: string, minutes: number): Promise<void> {
    const { error } = await supabase.rpc('rollback_transcription_usage', {
        p_user_id: userId,
        p_minutes: minutes,
    });

    if (error) {
        console.error('[rateLimit] Failed to rollback usage:', error);
    }
}

export { computeCycleResetDate };
