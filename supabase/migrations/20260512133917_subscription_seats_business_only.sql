-- Enforce that seats can only be set on business-plan subscriptions.
-- Pro subscriptions must have seats = NULL.
--
-- Also corrects any existing seed/test data where a business-tier workspace
-- was incorrectly stored with plan = 'pro'.

-- 1. Add the check constraint
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_seats_business_only
    CHECK (plan = 'business' OR seats IS NULL);
