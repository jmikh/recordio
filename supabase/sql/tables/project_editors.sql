│                               ddl                                │
├──────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.project_editors (              │
│     "project_id" UUID NOT NULL,                                  │
│     "user_id" UUID NOT NULL,                                     │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() │
│ );                                                               │
└──────────────────────────────────────────────────────────────────┘
│                                   rls_info                                    │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│ -- RLS: ENABLED                                                               │
│ -- Policy: project_editors_select (SELECT)                                    │
│ --   USING:      (EXISTS ( SELECT 1                                           │
│    FROM (projects p                                                           │
│      JOIN workspace_members wm ON ((wm.workspace_id = p.workspace_id)))       │
│   WHERE ((p.id = project_editors.project_id) AND (wm.user_id = auth.uid())))) │
└───────────────────────────────────────────────────────────────────────────────┘
