# Supabase Guidelines

## Hard Rules

- **Deploy with `--no-verify-jwt`** (or `verify_jwt = false` in `.config.toml`) — JWT verification is manual inside every function
- **Never use `SUPABASE_SECRET_KEY` in user-facing functions** — it bypasses RLS. Use `SUPABASE_PUBLISHABLE_KEY`; secret key is only for internal/cron functions
- **Handle CORS preflight** — every edge function must respond to `OPTIONS` with `corsHeaders`
- **Use `maybeSingle()` not `single()`** when the row might not exist
- **Always enable RLS on new tables** — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + at least one policy. No exceptions
- **New migrations go in `migrations/`** — see `migrations/CLAUDE.md` for naming and ordering rules. Never edit existing migrations

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
| `sql/triggers/` | Database trigger source (one `.sql` per trigger) |
| `sql/build-functions.sh` | Generates `migrations/*_functions.sql`, `*_crons.sql`, and `*_triggers.sql` |

---

## Adding Database Functions

1. Create `sql/functions/<name>.sql` with `CREATE OR REPLACE FUNCTION`
2. Run `sql/build-functions.sh` — writes a timestamped migration into `migrations/`

## Adding Cron Jobs

1. Create `sql/crons/cron_<name>.sql`
2. Run `sql/build-functions.sh` — writes a timestamped migration into `migrations/`

Two cron patterns exist:

- **Pattern A — pure SQL** (DB-only work, `SECURITY DEFINER`): create function + schedule with `cron.schedule()`
- **Pattern B — cron → edge function** (needs external APIs): `cron.schedule` calls `net.http_post` to the edge function

Always `cron.unschedule` before `cron.schedule` for idempotency.

## Adding Triggers

1. Create `sql/triggers/<table>_<event>.sql` (e.g. `users_after_insert.sql`)
2. Include `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER` for idempotency
3. If the trigger calls a function, define the function in the same file
4. Run `sql/build-functions.sh` — writes a timestamped migration into `migrations/`

---

## Naming Conventions

Use `{asset}_{verb}` for all named items that way  related functions are visually grouped together:

| Item | Example |
|---|---|
| Edge functions | `render_start`, `project_delete` |
| DB functions | `subscription_check`, `usage_reset` |
| Cron jobs | `cron_subscription_check`, `cron_usage_reset` |
| Triggers | `on_user_signup_create_user_profile`, `on_project_deleted_cleanup_storage` |

---

## Authentication Patterns

- **User-facing**: forward caller's JWT via `Authorization` header, use anon key, RLS applies
- **Internal/cron**: use `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS
- **External webhook (Stripe)**: no JWT — validate webhook signature instead
