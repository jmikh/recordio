# email_unsubscribes

Tracks users who have opted out of marketing/notification emails. Checked by the `send-welcome-email` edge function before sending. Users can manage their own unsubscribe status via the `unsubscribe` edge function.

**Accessed by:** `send-welcome-email` edge function, `unsubscribe` edge function.

**RLS:** Enabled. Users can manage their own row (`auth.uid() = user_id`).
