│                           ddl                            │
├──────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.user_profiles (        │
│     "user_id" UUID NOT NULL,                             │
│     "name" TEXT,                                         │
│     "trial_ends_at" TIMESTAMP WITH TIME ZONE,            │
│     "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now(), │
│     "default_workspace_id" UUID                          │
│ );                                                       │
└──────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
