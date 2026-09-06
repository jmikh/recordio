│                           ddl                            │
├──────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.subscriptions (        │
│     "user_id" UUID NOT NULL,                             │
│     "stripe_customer_id" TEXT,                           │
│     "stripe_subscription_id" TEXT,                       │
│     "status" TEXT NOT NULL DEFAULT 'inactive'::text,     │
│     "current_period_end" TIMESTAMP WITH TIME ZONE,       │
│     "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), │
│     "billing_interval" TEXT,                             │
│     "workspace_id" UUID NOT NULL,                        │
│     "seats" INTEGER NOT NULL DEFAULT 1,                  │
│     "plan" TEXT NOT NULL DEFAULT 'pro'::text,            │
│     "stripe_event_at" TIMESTAMP WITH TIME ZONE,          │
│     "cancel_at" TIMESTAMP WITH TIME ZONE                 │
│ );                                                       │
└──────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
