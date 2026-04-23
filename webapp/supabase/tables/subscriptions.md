# subscriptions

Stores user subscription and billing state. Created automatically when a new user signs up (via `handle_new_user` trigger, which inserts a 7-day trial). Updated by the `stripe-webhooks` edge function when Stripe events fire (checkout completed, subscription updated/canceled). Read by the frontend and backend auth middleware to gate features by plan.

**Accessed by:** `stripe-webhooks` edge function, `upload-to-stream` edge function, `expire_trials` SQL function, `handle_new_user` SQL trigger, frontend (`useAuthListener`, `UpgradeModal`), backend auth middleware.

**RLS:** Enabled. Users can view their own subscription (`auth.uid() = user_id`). Writes happen via service-role (Stripe webhooks, triggers).
