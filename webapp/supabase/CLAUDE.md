# Supabase Guidelines

## Hard Rules

- **Deploy with `--no-verify-jwt`** (or `verify_jwt = false` in `.config.toml`) — JWT verification is manual inside every function
- **Never use `SUPABASE_SECRET_KEY` in user-facing functions** — it bypasses RLS. Use `SUPABASE_PUBLISHABLE_KEY`; secret key is only for internal/cron functions
- **Handle CORS preflight** — every edge function must respond to `OPTIONS` with `corsHeaders`
- **Use `maybeSingle()` not `single()`** when the row might not exist
- **Always enable RLS on new tables** — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + at least one policy. No exceptions
- **New migrations go in `migrations/`** with timestamped filename (`YYYYMMDD_description.sql`). Never edit existing migrations

---

## Directory Structure

| Path | Purpose |
|---|---|
| `functions/<name>/index.ts` | Edge functions (one per folder) |
| `functions/<name>/.config.toml` | Per-function deploy config |
| `functions/_shared/` | Shared utilities (email templates, auth helpers) |
| `migrations/` | All SQL migrations (timestamped) |
| `tables/` | Per-table documentation |
| `sql/functions/` | Database function source (one `.sql` per function) |
| `sql/crons/` | Cron job source (one `.sql` per cron, `cron_` prefix) |
| `sql/build-functions.sh` | Generates `migrations/*_functions.sql` and `migrations/*_crons.sql` |

---

## Adding Database Functions

1. Create `sql/functions/<name>.sql` with `CREATE OR REPLACE FUNCTION`
2. Run `sql/build-functions.sh` — writes a timestamped migration into `migrations/`

## Adding Cron Jobs

1. Create `sql/crons/cron_<name>.sql`
2. Run `sql/build-functions.sh` — writes a timestamped migration into `migrations/`

Two cron patterns exist:

**Pattern A — pure SQL** (DB-only work, `SECURITY DEFINER`):
```sql
CREATE OR REPLACE FUNCTION public.cron_my_job() ...
```
Then schedule via a separate migration with `cron.schedule()`.

**Pattern B — cron → edge function** (needs external APIs):
```sql
SELECT cron.schedule('my-job', '0 * * * *', $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/my-function',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'::jsonb
    );
$$);
```
Always `cron.unschedule` before `cron.schedule` for idempotency.

---

## Authentication Patterns

### Pattern 1 — User-facing (forward caller's JWT, RLS applies)
```ts
const authHeader = req.headers.get('Authorization');
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } });
const { data: { user } } = await supabase.auth.getUser();
```

### Pattern 2 — Internal/cron (service role, bypasses RLS)
```ts
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```
Caller authenticates by passing service role key in `Authorization` header.

### Pattern 3 — External webhook (Stripe)
No JWT — validate webhook signature instead:
```ts
const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
```
