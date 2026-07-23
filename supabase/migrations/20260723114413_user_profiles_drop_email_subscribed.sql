-- Remove the email-unsubscribe machinery's only DB footprint (user
-- decision 2026-07-23, Wave E).
--
-- The unsubscribe edge function (deleted in the same change) flipped
-- this flag from a signed link in the welcome email, and
-- send-welcome-email skipped unsubscribed users. The welcome email no
-- longer carries an unsubscribe link, nothing else ever read the
-- column (the webapp never touched it), so it goes. The still-deployed
-- edge send-welcome-email survives the drop gracefully: its
-- .select('email_subscribed') error is swallowed by the destructure
-- and it just sends.

ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS email_subscribed;
