│                                                  ddl                                                  │
├───────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.screenshots (                                                       │
│     "id" UUID NOT NULL,                                                                               │
│     "created_by" UUID NOT NULL,                                                                       │
│     "owner_id" UUID NOT NULL,                                                                         │
│     "workspace_id" UUID NOT NULL,                                                                     │
│     "name" TEXT NOT NULL DEFAULT 'Untitled'::text,                                                    │
│     "screenshot_data" JSONB NOT NULL,                                                                 │
│     "source_storage_path" TEXT NOT NULL,                                                              │
│     "width_px" INTEGER NOT NULL,                                                                      │
│     "height_px" INTEGER NOT NULL,                                                                     │
│     "capture_mode" TEXT NOT NULL,                                                                     │
│     "page_url" TEXT,                                                                                  │
│     "page_title" TEXT,                                                                                │
│     "thumbnail_storage_path" TEXT,                                                                    │
│     "upload_status" TEXT NOT NULL DEFAULT 'pending'::text,                                            │
│     "cloud_version" INTEGER NOT NULL DEFAULT 1,                                                       │
│     "slug" TEXT NOT NULL DEFAULT "left"(replace((gen_random_uuid())::text, '-'::text, ''::text), 12), │
│     "share_policy" TEXT NOT NULL DEFAULT 'private'::text,                                             │
│     "workspace_access" TEXT NOT NULL DEFAULT 'view'::text,                                            │
│     "render_storage_path" TEXT,                                                                       │
│     "render_cloud_version" INTEGER,                                                                   │
│     "last_accessed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),                               │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),                                     │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),                                     │
│     "deleted_at" TIMESTAMP WITH TIME ZONE,                                                            │
│     "permanently_deleted" BOOLEAN NOT NULL DEFAULT false                                              │
│ );                                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
│    rls_info     │
├─────────────────┤
│                 │
│ -- RLS: ENABLED │
└─────────────────┘
