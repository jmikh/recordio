│                                                  ddl                                                  │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.projects (                                                          │
│     "id" UUID NOT NULL,                                                                               │
│     "created_by" UUID NOT NULL,                                                                       │
│     "name" TEXT NOT NULL DEFAULT 'Untitled'::text,                                                    │
│     "project_data" JSONB NOT NULL,                                                                    │
│     "thumbnail_storage_path" TEXT,                                                                    │
│     "upload_status" TEXT NOT NULL DEFAULT 'pending'::text,                                            │
│     "cloud_version" INTEGER NOT NULL DEFAULT 1,                                                       │
│     "last_accessed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),                               │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),                                     │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),                                     │
│     "deleted_at" TIMESTAMP WITH TIME ZONE,                                                            │
│     "expires_at" TIMESTAMP WITH TIME ZONE,                                                            │
│     "duration_ms" INTEGER,                                                                            │
│     "permanently_deleted" BOOLEAN NOT NULL DEFAULT false,                                             │
│     "render_storage_path" TEXT,                                                                       │
│     "render_cloud_version" INTEGER,                                                                   │
│     "slug" TEXT NOT NULL DEFAULT "left"(replace((gen_random_uuid())::text, '-'::text, ''::text), 12), │
│     "share_policy" TEXT NOT NULL DEFAULT 'private'::text,                                             │
│     "owner_id" UUID NOT NULL,                                                                         │
│     "workspace_id" UUID NOT NULL,                                                                     │
│     "workspace_access" TEXT NOT NULL DEFAULT 'view'::text                                             │
│ );                                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
