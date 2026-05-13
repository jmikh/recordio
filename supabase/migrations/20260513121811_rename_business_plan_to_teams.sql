-- Rename 'business' plan to 'teams' in the subscriptions table.
--
-- 1. Drop old check constraints that reference 'business'.
-- 2. Migrate existing data.
-- 3. Re-add constraints using 'teams'.

-- 1. Drop old constraints
ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_seats_business_only;

-- 2. Migrate existing 'business' rows to 'teams'
UPDATE public.subscriptions
SET plan = 'teams'
WHERE plan = 'business';

-- 3. Re-add plan check with 'teams'
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_plan_check
    CHECK (plan IN ('pro', 'teams'));

-- 4. Re-add seats constraint using 'teams'
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_seats_teams_only
    CHECK (plan = 'teams' OR seats IS NULL);
