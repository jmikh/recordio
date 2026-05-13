│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.render_jobs (                   │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                 │
│     "project_id" UUID NOT NULL,                                   │
│     "user_id" UUID NOT NULL,                                      │
│     "cloud_version" INTEGER NOT NULL,                             │
│     "status" TEXT NOT NULL DEFAULT 'pending'::text,               │
│     "progress" REAL,                                              │
│     "render_storage_path" TEXT,                                   │
│     "error" TEXT,                                                 │
│     "video_duration_s" REAL,                                      │
│     "start_duration_s" REAL,                                      │
│     "download_duration_s" REAL,                                   │
│     "render_duration_s" REAL,                                     │
│     "upload_duration_s" REAL,                                     │
│     "total_duration_s" REAL,                                      │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "attempt_count" INTEGER NOT NULL DEFAULT 1                    │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
│                      rls_info                      │
├────────────────────────────────────────────────────┤
│                                                    │
│ -- RLS: ENABLED                                    │
│ -- Policy: Users can view own render jobs (SELECT) │
│ --   USING:      (auth.uid() = user_id)            │
└────────────────────────────────────────────────────┘
