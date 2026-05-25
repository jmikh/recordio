│                               ddl                                │
├──────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.project_editors (              │
│     "project_id" UUID NOT NULL,                                  │
│     "user_id" UUID NOT NULL,                                     │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() │
│ );                                                               │
└──────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
