# Migrations

## Hard Rules

- **Filename format**: `YYYYMMDDHHMMSS_description.sql` — always include hours, minutes, and seconds to avoid collisions
- **Must sort last**: Before naming a new migration, run `ls migrations/` and ensure the timestamp sorts after all existing files
- **Always fetch the real timestamp**: Run `date -u '+%Y%m%d%H%M%S'` via the command line — never guess, assume, or hallucinate the current date/time
- **Never edit existing migrations** — they may already be applied to remote databases
- **One concern per migration** — don't bundle unrelated schema changes into a single file
- **Use IF NOT EXISTS / IF EXISTS** where possible so migrations are safe to re-run
