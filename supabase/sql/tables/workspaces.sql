│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.workspaces (                    │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                 │
│     "name" TEXT NOT NULL,                                         │
│     "owner_id" UUID NOT NULL,                                     │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "deleted_at" TIMESTAMP WITH TIME ZONE                         │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
