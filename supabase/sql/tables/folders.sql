│                                ddl                                │
├───────────────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.folders (                       │
│     "id" UUID NOT NULL DEFAULT gen_random_uuid(),                 │
│     "user_id" UUID NOT NULL,                                      │
│     "name" TEXT NOT NULL,                                         │
│     "description" TEXT NOT NULL DEFAULT ''::text,                 │
│     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), │
│     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()  │
│ );                                                                │
└───────────────────────────────────────────────────────────────────┘
