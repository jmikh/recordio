│                                   ddl                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.projects (                            │
│     "id" UUID NOT NULL,                                                 │
│     "created_by" UUID NOT NULL,                                         │
│     "name" TEXT NOT NULL DEFAULT 'Untitled'::text,                      │
│     "project_data" JSONB NOT NULL,                                      │
│     "thumbnail_storage_path" TEXT,                                      │
│     "upload_status" TEXT NOT NULL DEFAULT 'pending'::text,              │
│     "cloud_version" INTEGER NOT NULL DEFAULT 1,                         │
│     "last_accessed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),       │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),       │
│     "deleted_at" TIMESTAMP WITH TIME ZONE,                              │
│     "expires_at" TIMESTAMP WITH TIME ZONE,                              │
│     "duration_ms" INTEGER,                                              │
│     "permanently_deleted" BOOLEAN NOT NULL DEFAULT false,               │
│     "render_storage_path" TEXT,                                         │
│     "render_cloud_version" INTEGER,                                     │
│     "slug" TEXT,                                                        │
│     "share_policy" TEXT,                                                │
│     "folder_id" UUID,                                                   │
│     "is_starred" BOOLEAN NOT NULL DEFAULT false,                        │
│     "owner_id" UUID NOT NULL,                                           │
│     "workspace_id" UUID NOT NULL                                        │
│ );                                                                      │
└─────────────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
