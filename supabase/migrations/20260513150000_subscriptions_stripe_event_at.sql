-- Track the Stripe event timestamp on each subscription row.
-- Used to discard out-of-order webhook deliveries: if an incoming event's
-- created timestamp is older than what's already stored, it's skipped.

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS stripe_event_at TIMESTAMPTZ;
