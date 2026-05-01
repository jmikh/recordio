# Subscription Redesign: Separate Trial from Stripe

## Context

The `subscriptions` table conflates two unrelated concepts:
- **App-level free trial** (7-day, created on signup, never touches Stripe)
- **Stripe subscription state** (active, past_due, canceled, etc.)

This causes `status = 'trialing'` to mean "free trial" (app concept) while Stripe also has its own `trialing` status. `past_due` is defined in TypeScript but never grants Pro access. Dead columns (`plan_id`, `current_period_start`, `id`) add noise. The `cron_expire_trials` function is defined but never scheduled. Lifetime billing is also being removed.

## Design

- New `user_profiles` table owns user-level state: `name`, `trial_ends_at`, `email_subscribed` (bool, default true)
- `email_unsubscribes` table folded into `user_profiles.email_subscribed` column — one fewer table
- `subscriptions` table becomes purely Stripe — stores Stripe status verbatim
- `handle_new_user` trigger creates a profile row (with trial + name) instead of a subscription row
- Subscription row only created when Stripe checkout completes
- `past_due` grants Pro access (grace period while Stripe retries payment)
- Lifetime billing removed from all code paths

---

## Step 1 — Migration: create `user_profiles`, clean up `subscriptions`

**New file**: `supabase/migrations/<timestamp>_user_profiles_and_subscription_cleanup.sql`

```sql
-- 1. Create user_profiles table
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

-- 2. Backfill: create profile rows for ALL existing users
--    - name from auth.users metadata (full_name or name)
--    - trial_ends_at from subscriptions if trialing/expired, otherwise created_at + 7 days
--    - email_subscribed = false if user exists in email_unsubscribes
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

-- 3. Drop email_unsubscribes table (data migrated to user_profiles.email_subscribed)
DROP TABLE IF EXISTS public.email_unsubscribes;

-- 4. Clean up subscriptions: remove trial-only rows (no Stripe data)
DELETE FROM public.subscriptions
WHERE stripe_customer_id IS NULL AND stripe_subscription_id IS NULL;

-- 5. Drop dead columns from subscriptions
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS plan_id;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS current_period_start;

-- 6. Replace surrogate PK with natural PK
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS id;
ALTER TABLE public.subscriptions ADD PRIMARY KEY (user_id);
```

## Step 2 — Update `handle_new_user()` trigger

**File**: `supabase/sql/functions/handle_new_user.sql`

Create a `user_profiles` row with `name` + `trial_ends_at`. Stop creating a subscription row.

```sql
INSERT INTO public.user_profiles (user_id, name, trial_ends_at, updated_at)
VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    now() + interval '7 days',
    now()
);
```

## Step 3 — New RPC: `user_profile_get()`

**New file**: `supabase/sql/functions/user_profile_get.sql`

Returns the user's profile. Called alongside `subscription_get` on login.

```sql
SELECT jsonb_build_object(
    'name', p.name,
    'trial_ends_at', p.trial_ends_at
)
FROM public.user_profiles p
WHERE p.user_id = auth.uid();
```

## Step 4 — Update `subscription_get()`

**File**: `supabase/sql/functions/subscription_get.sql`

- Remove `plan_id` from output
- Keep everything else (status, current_period_end, cancel_at_period_end, stripe_customer_id, billing_interval)

## Step 5 — Delete `cron_expire_trials`

**File**: `supabase/sql/crons/cron_expire_trials.sql` — delete

No longer needed. Trial expiry is just `trial_ends_at < now()`, checked client-side and in `hasProAccess()`.

## Step 6 — Update Stripe webhook

**File**: `supabase/functions/stripe-webhooks/index.ts`

- Remove lifetime handling from `handleCheckoutCompleted` (no more `isLifetime` branch)
- `handleSubscriptionUpdate`: add `past_due` to Pro check:
  ```
  const isNowPro = newStatus === 'active' || newStatus === 'trialing' || newStatus === 'past_due';
  ```
  (Stripe's `trialing` here means a Stripe trial period, not our app trial — handle it correctly)

## Step 7 — Remove lifetime from `stripe-checkout`

**File**: `supabase/functions/stripe-checkout/index.ts`

- Remove `lifetime` from `PRICE_IDS`
- Remove `isLifetime` logic and `mode: 'payment'` branch — always `mode: 'subscription'`

## Step 8 — Update `useUserStore`

**File**: `webapp/src/editor/stores/useUserStore.ts`

- Remove `planId` from `Subscription` interface
- Remove `'trialing'` from `Subscription.status` (trial is no longer a subscription concept)
- Add `trialEndsAt: Date | null` as top-level user state (not inside subscription)
- Remove `'lifetime'` from `billingInterval`
- Update `isPro`:
  ```
  isPro: isDevPro || subscription.status === 'active' || subscription.status === 'past_due'
  ```
- Update `hasFreeTrial()`:
  ```
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
  ```
- `hasProAccess()` stays: `isPro || hasFreeTrial()`
- Add `setTrialEndsAt(date)` action

## Step 9 — Update `AuthManager`

**File**: `webapp/src/auth/AuthManager.ts`

- `fetchSubscription`: remove `planId` mapping, handle case where user has no subscription row (free/trial-only users)
- Add `fetchProfile()`: calls `user_profile_get` RPC, maps `trial_ends_at` → `setTrialEndsAt()`
- Call `fetchProfile()` alongside `fetchSubscription()` in `handleSession()`

## Step 10 — Update `UserMenu`

**File**: `webapp/src/components/UserMenu.tsx`

- `isTrialing`: derive from `trialEndsAt` instead of `subscription.status === 'trialing'`
- Remove `subscription.billingInterval === 'lifetime'` display branch

## Step 11 — Update `UpgradeModal`

**File**: `webapp/src/editor/components/header/UpgradeModal.tsx`

- Remove `plan_id` from polling response mapping
- Remove lifetime billing interval option
- Remove `isLifetimeSubscriber` logic

## Step 12 — Update `StripeService`

**File**: `webapp/src/editor/stripe/StripeService.ts`

- Remove `'lifetime'` from `interval` type: `'monthly' | 'yearly'`

## Step 13 — Update `unsubscribe` edge function

**File**: `supabase/functions/unsubscribe/index.ts`

Change from inserting into `email_unsubscribes` table to updating `user_profiles.email_subscribed = false`.

## Step 14 — Update `send-welcome-email` edge function

**File**: `supabase/functions/send-welcome-email/index.ts`

Change unsubscribe check from querying `email_unsubscribes` table to checking `user_profiles.email_subscribed = false`.

## Step 15 — Run `build-functions.sh`

Generates new migration files for the updated SQL functions/crons.

---

## Backward Compatibility

- **Old client code cached in browser**: `subscription_get()` still returns the same shape minus `plan_id` (which was always null). Old clients that check `status === 'trialing'` will just see `null` status for trial-only users (no subscription row) — they'll lose trial access until they refresh. This is acceptable since the app auto-updates on deploy.
- **Existing Stripe subscribers**: Unaffected — their subscription rows are preserved, only trial-only rows (no `stripe_customer_id`) are deleted.
- **Existing trialing users**: Their `current_period_end` is migrated to `user_profiles.trial_ends_at`.
- **Existing expired trial users**: Get a `trial_ends_at` in the past (derived from `created_at + 7 days`), so they correctly show as expired.

## Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_....sql` | New migration (create) |
| `supabase/sql/functions/handle_new_user.sql` | Create profile, not subscription |
| `supabase/sql/functions/user_profile_get.sql` | New RPC (create) |
| `supabase/sql/functions/subscription_get.sql` | Remove `plan_id` |
| `supabase/sql/crons/cron_expire_trials.sql` | Delete |
| `supabase/functions/stripe-webhooks/index.ts` | Remove lifetime, add `past_due` |
| `supabase/functions/stripe-checkout/index.ts` | Remove lifetime |
| `webapp/src/editor/stores/useUserStore.ts` | Trial as top-level state, remove lifetime |
| `webapp/src/auth/AuthManager.ts` | Add `fetchProfile()`, update subscription mapping |
| `webapp/src/components/UserMenu.tsx` | Use `trialEndsAt`, remove lifetime display |
| `webapp/src/editor/components/header/UpgradeModal.tsx` | Remove `plan_id`, lifetime |
| `webapp/src/editor/stripe/StripeService.ts` | Remove lifetime interval |
| `supabase/functions/unsubscribe/index.ts` | Use `user_profiles.email_subscribed` instead of `email_unsubscribes` table |
| `supabase/functions/send-welcome-email/index.ts` | Check `user_profiles.email_subscribed` instead of `email_unsubscribes` table |

## Verification

1. Run `sql/build-functions.sh` to generate migration files
2. Apply migrations to local DB
3. Test new signup → profile created with `trial_ends_at`, no subscription row
4. Test trial user sees Pro features + "Trial ends..." badge
5. Test expired trial correctly gates 1080p+ exports
6. Test Stripe checkout → subscription row created, user becomes Pro
7. Verify `past_due` status keeps Pro access
8. Verify `canceled` / `deleted` → loses Pro, 14-day project expiry
9. Verify no lifetime references remain in UI or backend
