│                               ddl                                │
├──────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.workspace_invitations (        │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                │
│     "workspace_id" UUID NOT NULL,                                │
│     "email" TEXT NOT NULL,                                       │
│     "role" TEXT NOT NULL,                                        │
│     "invited_by" UUID NOT NULL,                                  │
│     "token" UUID NOT NULL DEFAULT gen_random_uuid(),             │
│     "status" TEXT NOT NULL DEFAULT 'pending'::text,              │
│     "expires_at" TIMESTAMP WITH TIME ZONE,                       │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() │
│ );                                                               │
└──────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
