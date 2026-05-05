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
| `sql/graveyard.sql` | `DROP` statements for removed functions/crons/triggers |
| `sql/deploy.sh` | Deploys all `sql/` code to local or remote DB |

---

## Deploying SQL Code (Functions, Crons, Triggers)

All SQL in `sql/` is idempotent — deployed directly via `sql/deploy.sh`, **not** through migrations.

```
sql/deploy.sh              # local
sql/deploy.sh --remote     # production (uses supabase db url --linked)
```

| Action | What to do |
|---|---|
| Add function | Create `sql/functions/<name>.sql` with `CREATE OR REPLACE FUNCTION` |
| Add cron | Create `sql/crons/cron_<name>.sql`. Always `cron.unschedule` before `cron.schedule` |
| Add trigger | Create `sql/triggers/<name>.sql`. `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER` |
| Remove any of the above | Delete the source file, add `DROP` statement to `sql/graveyard.sql` |

Two cron patterns:
- **Pattern A — pure SQL**: function + `cron.schedule()`, for DB-only work
- **Pattern B — cron → edge function**: `cron.schedule` calls `net.http_post`, for external APIs

Migrations (`migrations/`) are only for schema changes (tables, columns, RLS). Never put functions/crons/triggers in migrations.

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

---

## Vault for Environment-Specific Config

Crons and triggers that make HTTP calls (Pattern B) resolve `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from [Supabase Vault](https://supabase.com/docs/guides/database/vault) at runtime — never hardcode URLs or keys. This keeps one source of truth for local and production.

- **Production**: add secrets via Dashboard (Settings → Vault)
- **Local**: seeded in `seed.sql` via `vault.create_secret()`
- **Access pattern**: `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '...'`
- **Do not** use `supabase_functions.http_request` — it only accepts hardcoded args. Use `net.http_post` in a custom `plpgsql` function instead.
