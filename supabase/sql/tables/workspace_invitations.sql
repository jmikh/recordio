│                               ddl                                │
├──────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.workspace_invitations (        │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                │
│     "workspace_id" UUID NOT NULL,                                │
│     "email" TEXT NOT NULL,                                       │
│     "role" TEXT NOT NULL,                                        │
│     "invited_by" UUID NOT NULL,                                  │
│     "token" UUID NOT NULL DEFAULT gen_random_uuid(),             │
│     "status" TEXT NOT NULL DEFAULT 'pending'::text,              │
│     "expires_at" TIMESTAMP WITH TIME ZONE,                       │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() │
│ );                                                               │
└──────────────────────────────────────────────────────────────────┘
│                                                                                   rls_info                                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                                                                              │
│ -- RLS: ENABLED                                                                                                                                                              │
│ -- Policy: workspace_invitations_select (SELECT)                                                                                                                             │
│ --   USING:      ((email = (( SELECT users.email                                                                                                                             │
│    FROM auth.users                                                                                                                                                           │
│   WHERE (users.id = auth.uid())))::text) OR (EXISTS ( SELECT 1                                                                                                               │
│    FROM workspace_members                                                                                                                                                    │
│   WHERE ((workspace_members.workspace_id = workspace_invitations.workspace_id) AND (workspace_members.user_id = auth.uid()) AND (workspace_members.role = 'admin'::text))))) │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
