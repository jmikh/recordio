│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.user_assets (                   │
│     "id" TEXT NOT NULL,                                           │
│     "user_id" UUID NOT NULL,                                      │
│     "asset_type" TEXT NOT NULL,                                   │
│     "storage_path" TEXT NOT NULL,                                 │
│     "name" TEXT,                                                  │
│     "size_bytes" BIGINT DEFAULT 0,                                │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "is_deleted" BOOLEAN NOT NULL DEFAULT false,                  │
│     "status" TEXT NOT NULL DEFAULT 'ready'::text                  │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
