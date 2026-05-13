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
│                                                  rls_info                                                  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                            │
│ -- RLS: ENABLED                                                                                            │
│ -- Policy: workspace_delete (DELETE)                                                                       │
│ --   USING:      (owner_id = auth.uid())                                                                   │
│ -- Policy: workspace_insert (INSERT)                                                                       │
│ --   WITH CHECK: (owner_id = auth.uid())                                                                   │
│ -- Policy: workspace_select (SELECT)                                                                       │
│ --   USING:      ((owner_id = auth.uid()) OR (EXISTS ( SELECT 1                                            │
│    FROM workspace_members                                                                                  │
│   WHERE ((workspace_members.workspace_id = workspaces.id) AND (workspace_members.user_id = auth.uid()))))) │
│ -- Policy: workspace_update (UPDATE)                                                                       │
│ --   USING:      (owner_id = auth.uid())                                                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
