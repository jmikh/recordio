-- Single plan: every subscription is per-seat with seats >= 1.
-- The plan column stays physically until Step 8 of the billing revamp
-- (plans/workspace-billing-revamp/workspace-billing-revamp-tiered-plan.md); no code reads or writes it after
-- this step — inserts fall back to the 'pro' default.

-- The seats-only-on-teams constraint (renamed from _business_only by
-- migration 20260513121811) goes away entirely.
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_teams_only;
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_business_only;

UPDATE public.subscriptions SET seats = 1 WHERE seats IS NULL;

ALTER TABLE public.subscriptions
    ALTER COLUMN seats SET NOT NULL,
    ALTER COLUMN seats SET DEFAULT 1;

ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_min;

ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_seats_min CHECK (seats >= 1);
