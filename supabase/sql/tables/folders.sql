│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.folders (                       │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                 │
│     "name" TEXT NOT NULL,                                         │
│     "description" TEXT NOT NULL DEFAULT ''::text,                 │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "workspace_id" UUID NOT NULL                                  │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
│                                                     rls_info                                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                  │
│ -- RLS: ENABLED                                                                                                  │
│ -- Policy: folders_select (SELECT)                                                                               │
│ --   USING:      (EXISTS ( SELECT 1                                                                              │
│    FROM workspace_members                                                                                        │
│   WHERE ((workspace_members.workspace_id = folders.workspace_id) AND (workspace_members.user_id = auth.uid())))) │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
