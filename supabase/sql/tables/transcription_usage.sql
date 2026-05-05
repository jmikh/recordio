│                           ddl                           │
├─────────────────────────────────────────────────────────┤
│ CREATE TABLE IF NOT EXISTS public.transcription_usage ( │
│     "user_id" UUID NOT NULL,                            │
│     "minutes_used" NUMERIC(8,3) NOT NULL DEFAULT 0,     │
│     "reset_date" TIMESTAMP WITH TIME ZONE NOT NULL,     │
│     "minutes_limit" NUMERIC(8,3) NOT NULL DEFAULT 60    │
│ );                                                      │
└─────────────────────────────────────────────────────────┘
