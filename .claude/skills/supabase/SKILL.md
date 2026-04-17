---
name: supabase
description: Supabase reference for this codebase. Covers edge functions, auth patterns, deployment, cron jobs, and database conventions.
when_to_use: When writing or modifying Supabase edge functions, SQL migrations, cron jobs, or anything touching the Supabase backend.
---

# Supabase Guidelines

## Hard Rules

- **Always deploy with `--no-verify-jwt`** (or `verify_jwt = false` in `.config.toml`) — Supabase's built-in JWT handling is deprecated; authentication is always verified manually inside the function
- **Never use `SUPABASE_SECRET_KEY` in user-facing functions** — service role bypasses RLS entirely. Use `SUPABASE_PUBLISHABLE_KEY`; only use it for internal/cron functions
- **Always handle CORS preflight** — every edge function must respond to `OPTIONS` with `corsHeaders`
- **Use `maybeSingle()` not `single()`** when the row might not exist — `single()` throws on missing rows
- **Always enable RLS on new tables** — every `CREATE TABLE` must be followed by `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and at least one policy. No exceptions, even for internal tables (use a service-role-only policy instead of skipping RLS)
- **New migrations go in `webapp/supabase/migrations/`** with a timestamped filename (`YYYYMMDD_description.sql`)
- **Cron jobs that call edge functions must pass `Authorization: Bearer <SUPABASE_SECRET_KEY>`** so the function knows it's an internal call
- **ALWAYS use Secret API keys instead of service role key** for internal functions, server usage..etc. Service role and anon keys are deprecated in supabase.

---

## Edge Functions

All functions live in `webapp/supabase/functions/<function-name>/index.ts`.

### Boilerplate

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    // ...
});
```

### Env vars available automatically in every function

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Public key (respects RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (bypasses RLS) |

Custom secrets (e.g. `STRIPE_SECRET_KEY`) are set via `supabase secrets set` and accessed with `Deno.env.get(...)`.

---

## Authentication Inside Functions

Authentication is always handled manually. There are three patterns — pick the right one.

### Pattern 1 — User-facing functions (verify the caller)

Forward the client's `Authorization` header to create a scoped Supabase client. The client will only see data the user is allowed to see (RLS applies).

```ts
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
}

const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
);

const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
}
// user.id is now safe to trust
```

See: `webapp/supabase/functions/get-video-analytics/index.ts`, `webapp/supabase/functions/create-checkout-session/index.ts`

### Pattern 2 — Internal / cron-triggered functions (service role)

Use `SUPABASE_SERVICE_ROLE_KEY` directly. The caller (pg_net cron) authenticates by passing the service role key in the `Authorization` header — verify it's present to reject random web traffic.

```ts
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
}

const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);
```

See: `webapp/supabase/functions/purge-deleted-videos/index.ts`

### Pattern 3 — External webhook functions (Stripe, etc.)

No JWT at all. Validate the webhook's own signature instead:

```ts
const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
```

See: `webapp/supabase/functions/stripe-webhooks/index.ts`

---

## Deployment

Every function is deployed with `--no-verify-jwt`. Supabase's own JWT verification is deprecated — authentication is always done manually inside the function (see patterns above).

### Deploy a function

```bash
supabase functions deploy <function-name> --no-verify-jwt
```

### Persist the setting in-repo (preferred)

Create `webapp/supabase/functions/<function-name>/.config.toml` so the setting is checked in and doesn't need to be passed on every deploy:

```toml
verify_jwt = false
```

See: `webapp/supabase/functions/create-checkout-session/.config.toml`

---

## Cron Jobs

Cron jobs are set up in SQL migrations using `pg_cron` and `pg_net`.

### Two cron patterns

**Pattern A — pure SQL function** (no network call, for DB-only work):
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.my_job()
RETURNS void AS $$
BEGIN
    -- do DB work here
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT cron.unschedule('my-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my-job');

SELECT cron.schedule('my-job', '0 * * * *', $$SELECT public.my_job()$$);
```

See: `webapp/supabase/migrations/20260227_trial_expiry_cron.sql`

**Pattern B — cron calls an edge function** (use when you need external API access or heavy logic):
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('my-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'my-job');

SELECT cron.schedule(
    'my-job',
    '0 * * * *',
    $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/my-function',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
    $$
);
```

The edge function checks for the `Authorization` header to verify it's an internal call (Pattern 2 auth). Replace `<SUPABASE_URL>` and `<SERVICE_ROLE_KEY>` with actual values before running in the Supabase Dashboard.

See: `webapp/supabase/migrations/20260413_direct_upload_and_soft_delete.sql`

### Cron syntax quick-ref

| Schedule | Expression |
|---|---|
| Every minute | `* * * * *` |
| Every 15 minutes | `*/15 * * * *` |
| Every hour | `0 * * * *` |
| Daily at midnight UTC | `0 0 * * *` |

### Idempotent scheduling

Always unschedule before scheduling — migrations may be re-run:
```sql
SELECT cron.unschedule('job-name')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-name');
```

---

## Database Conventions

- **Always enable RLS on new tables** — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` after every `CREATE TABLE`. Tables accessed directly from the webapp (via publishable key) need `auth.uid()` policies. Tables only accessed from edge functions (via secret key) need no policies — secret key bypasses RLS, so deny-all is the default
- **`SECURITY DEFINER`** on cron functions — they run as the function owner, not the calling role
- **`pg_net` HTTP calls from SQL** — use for firing webhooks or calling external APIs from cron without leaving the DB layer; fire-and-forget, not awaited

---

## Key Files

| Path | Purpose |
|---|---|
| `webapp/supabase/functions/` | All edge functions |
| `webapp/supabase/functions/_shared/` | Shared utilities (email templates, Resend client) |
| `webapp/supabase/migrations/` | All SQL migrations |
| `webapp/supabase/functions/<name>/.config.toml` | Per-function deploy config (`verify_jwt = false`) |
