-- =============================================================================
-- Migration: Remove Mixpanel HTTP calls from handle_new_user() trigger
--
-- The Mixpanel profile-set and account_created tracking are now handled by
-- the `on-user-created` edge function (invoked via Database Webhook).
-- This keeps the trigger lean — only the subscription row insert remains.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
    -- Create trialing subscription (7-day free trial)
    insert into public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    values (new.id, 'trialing', now() + interval '7 days', true, now());

    return new;
end;
$$ language plpgsql security definer;
