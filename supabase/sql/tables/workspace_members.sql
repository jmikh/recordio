│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.workspace_members (             │
│     "workspace_id" UUID NOT NULL,                                 │
│     "user_id" UUID NOT NULL,                                      │
│     "role" TEXT NOT NULL,                                         │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()  │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
