│                           ddl                            │
├──────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.subscriptions (        │
│     "user_id" UUID NOT NULL,                             │
│     "stripe_customer_id" TEXT,                           │
│     "stripe_subscription_id" TEXT,                       │
│     "status" TEXT NOT NULL DEFAULT 'inactive'::text,     │
│     "current_period_end" TIMESTAMP WITH TIME ZONE,       │
│     "cancel_at_period_end" BOOLEAN DEFAULT false,        │
│     "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), │
│     "billing_interval" TEXT                              │
│ );                                                       │
└──────────────────────────────────────────────────────────┘
