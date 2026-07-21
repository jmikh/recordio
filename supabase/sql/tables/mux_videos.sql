│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.mux_videos (                    │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                 │
│     "project_id" UUID NOT NULL,                                   │
│     "user_id" UUID NOT NULL,                                      │
│     "cloud_version" INTEGER NOT NULL,                             │
│     "attempt" INTEGER NOT NULL DEFAULT 1,                         │
│     "mux_asset_id" TEXT,                                          │
│     "mux_playback_id" TEXT,                                       │
│     "status" TEXT NOT NULL DEFAULT 'pending'::text,               │
│     "error" TEXT,                                                 │
│     "render_storage_path" TEXT,                                   │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()  │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
