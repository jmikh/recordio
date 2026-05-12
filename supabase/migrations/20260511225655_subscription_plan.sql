-- Add plan column to subscriptions
--
-- Distinguishes 'pro' from 'business' subscriptions.
-- Populated by the Stripe webhook from price.metadata.plan_type.
-- Existing active subscriptions are backfilled as 'pro'.

-- 1. Add nullable first
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS plan TEXT
    CHECK (plan IN ('pro', 'business'));

-- 2. Backfill existing rows — all pre-existing subscriptions are Pro
UPDATE public.subscriptions
SET plan = 'pro'
WHERE plan IS NULL;

-- 3. Enforce NOT NULL
ALTER TABLE public.subscriptions
    ALTER COLUMN plan SET NOT NULL;

-- 4. Set default so new rows from webhooks that predate the code deploy don't break
ALTER TABLE public.subscriptions
    ALTER COLUMN plan SET DEFAULT 'pro';
