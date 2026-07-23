-- Replace subscriptions.cancel_at_period_end (boolean) with cancel_at (timestamptz).
--
-- Newer Stripe API versions (2025+, e.g. 2025-12-15.clover) schedule portal
-- cancellations via the subscription's cancel_at timestamp and leave the
-- legacy cancel_at_period_end boolean false, so the boolean silently stopped
-- reflecting cancellations. NULL = renews; set = subscription ends then.

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS "cancel_at" TIMESTAMP WITH TIME ZONE;

-- Backfill: a pending period-end cancellation ends at current_period_end
UPDATE public.subscriptions
    SET cancel_at = current_period_end
    WHERE cancel_at_period_end IS TRUE AND cancel_at IS NULL;

ALTER TABLE public.subscriptions
    DROP COLUMN IF EXISTS "cancel_at_period_end";
