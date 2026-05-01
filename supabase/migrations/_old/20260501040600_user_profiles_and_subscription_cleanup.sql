-- Migration: Create user_profiles table, fold email_unsubscribes, clean up subscriptions
-- This separates app-level state (trial, name, email prefs) from Stripe subscription data.

-- ============================================================
-- 1. Create user_profiles table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name text,
    trial_ends_at timestamptz,
    email_subscribed boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.user_profiles
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- 2. Backfill profile rows for ALL existing users
-- ============================================================
INSERT INTO public.user_profiles (user_id, name, trial_ends_at, email_subscribed, created_at)
SELECT
    u.id,
    COALESCE(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name'
    ),
    COALESCE(
        CASE WHEN s.status IN ('trialing', 'expired') THEN s.current_period_end END,
        u.created_at + interval '7 days'
    ),
    NOT EXISTS (SELECT 1 FROM public.email_unsubscribes eu WHERE eu.user_id = u.id),
    u.created_at
FROM auth.users u
LEFT JOIN public.subscriptions s ON s.user_id = u.id
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- 3. Drop email_unsubscribes table (migrated to user_profiles.email_subscribed)
-- ============================================================
DROP TABLE IF EXISTS public.email_unsubscribes;

-- ============================================================
-- 4. Clean up subscriptions: remove trial-only rows (no Stripe data)
-- ============================================================
DELETE FROM public.subscriptions
WHERE stripe_customer_id IS NULL AND stripe_subscription_id IS NULL;

-- ============================================================
-- 5. Drop dead columns from subscriptions
-- ============================================================
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS plan_id;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS current_period_start;

-- ============================================================
-- 6. Replace surrogate PK with natural PK (user_id)
-- ============================================================
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS id;
ALTER TABLE public.subscriptions ADD PRIMARY KEY (user_id);
