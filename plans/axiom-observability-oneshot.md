# Axiom Observability: Route Dashboards, Error Rates & Alerts

> On approval, rename this file to `.claude/plans/axiom-observability.md` (CLAUDE.md: meaningful plan names).

## Context

Logging was recently standardized: every request emits one canonical JSON event (`onResponse` hook, [server/src/app.ts:123-132](server/src/app.ts#L123-L132)) with `http.route` (template), `http.request.method`, `http.response.status_code`, `duration_ms`, `user_id`, typed domain fields, and a stable `error_type` enum. Scheduled jobs emit typed `job.run` events. The goal now is visibility: dashboards for per-route traffic, error codes, success rates, latency, and job health — plus alerts.

**Chosen backend: Axiom** (free Personal plan: 500 GB/mo ingest, 30-day retention, dashboards + monitors included — expected cost $0 at current traffic).

**Ingestion path: app-side `@axiomhq/pino` transport.** Railway has no native log drains (still an open community request), and the migration plan already anticipated "app-side pino transport later; transport is config-only change". Stdout NDJSON is kept in parallel so the Railway log viewer keeps working.

**User decisions (final):**
- `AXIOM_TOKEN` / `AXIOM_DATASET` are **required** env vars. Datasets are **per-environment**: `recordio-server` (prod/Railway), `recordio-server-dev` (local dev), each with its own scoped ingest token — prod dashboards/monitors need no env filters, so a forgotten filter can't pollute prod metrics or fire false alerts. *(Revised 2026-09-01 from the original one-shared-dataset choice.)*
- Alerts delivered by **email**.

Verified compat: `@axiomhq/pino@2.0.0` has no pino peer dep (only `pino-abstract-transport ^3.0.0`, same major as pino 10.3.1). Redaction/base run in the main thread, so the PII backstop holds — Axiom stores `[redacted]`.

## Part A — Code changes (server/)

### A1. Dependency
`cd server && npm install @axiomhq/pino` → runtime `dependencies` (tsup externalizes bare imports; must not be a devDependency).

### A2. `server/src/logging.ts` — rework `createLogger`
Extend options: `axiom?: { dataset: string; token: string }`. Compose three modes:
- **Test** (`stream` set): `pino(options, stream)` — bypasses transports entirely; tests can never touch Axiom. (`stream` check moves ahead of `pretty`.)
- **No axiom**: preserve exact current behavior (pretty transport or plain stdout).
- **Axiom**: `pino.transport({ targets: [stdoutTarget, axiomTarget] })` where `stdoutTarget` is `pino-pretty` (dev) or `pino/file` destination 1 (prod). **Every target carries an explicit `level`** — pino multistream defaults targets to `info` regardless of logger level.
- Attach `transport.on('error', ...)` → `console.error`: an unlistened ThreadStream `'error'` would crash the process via uncaughtException.

### A3. `server/src/app.ts` — pass-through
Add `axiom?: { dataset, token }` to `AppOptions`; thread into the `createLogger` call (~line 99).

### A4. `server/src/config.ts` — required vars
After `PUBLIC_URL`: `AXIOM_TOKEN` and `AXIOM_DATASET`, both `Type.String({ minLength: 1 })`, with a comment explaining the app-side transport (no Railway drains) and the shared-dataset decision.

### A5. `server/src/server.ts` — wiring + graceful shutdown
- Add `axiom: { dataset: config.AXIOM_DATASET, token: config.AXIOM_TOKEN }` to the `buildApp` options.
- Add SIGTERM/SIGINT handler: `app.close()` → `pool.end()` → ~2 s flush window → `process.exit(0)`, with a 10 s unref'd failsafe. Railway sends SIGTERM on redeploy; without this the transport worker's in-flight Axiom batch (≤ ~1 s of logs) is dropped. Stdout is unaffected either way; true crashes still lose the tail (Sentry + Railway viewer cover forensics).

### A6. Docs + env files
- `server/README.md`: two rows in the env table; add vars to the Railway setup checklist.
- `server/.env.example`: both vars with a comment that dev ships to the shared dataset.
- Optional guard test in `server/test/logging.test.ts`: `stream` + `axiom` together still writes to the stream (proves precedence).

**Test impact: none.** All logger-touching tests inject `logStream` (early-return path) or use no stream/pretty (plain pino). No test calls `loadConfig`, so the new required vars don't affect vitest/CI.

## Part B — Axiom setup (manual, user's browser; I'll provide values/queries)

1. Create Axiom account (Personal, free) — US region.
2. Create datasets `recordio-server` (prod) and `recordio-server-dev` (local dev).
3. Create an **ingest-only** API token per dataset.
4. Set `AXIOM_TOKEN`/`AXIOM_DATASET` in **Railway UI first** (config makes boot fail-closed without them), and in local `.env.local`/`.env.prod`.
5. Create email notifier (default account email).

## Part C — Dashboard: "API Health" (one dashboard, built in Axiom UI)

Note: the transport maps pino's numeric level → name (`level == "error"`) and `time` → `_time`. Dashboard and monitors point at the prod dataset `recordio-server` — no env filters needed (dev ships to `recordio-server-dev`).

| Panel | APL sketch |
|---|---|
| Traffic by status class | `where msg == "request" \| summarize count() by bin_auto(_time), strcat(substring(tostring(['http.response.status_code']),0,1), "xx")` |
| Success rate per route | `where msg == "request" \| summarize total=count(), err5=countif(['http.response.status_code'] >= 500) by ['http.route'] \| extend success_pct = round(100.0*(total-err5)/total, 2) \| sort by total desc` |
| Error breakdown | `where msg == "request" and ['http.response.status_code'] >= 400 \| summarize count() by ['http.route'], ['http.response.status_code'], ['error_type']` |
| Latency p50/p95/p99 per route | `where msg == "request" \| summarize percentiles_array(duration_ms, 50, 95, 99) by ['http.route']` |
| Slowest routes over time | `where msg == "request" \| summarize p95=percentile(duration_ms, 95) by bin_auto(_time), ['http.route']` |
| Job runs | `where event == "job.run" \| summarize runs=count(), failures=countif(['job.status'] == "failure"), items_failed=sum(['job.items_failed']) by ['job.name'], bin(_time, 1d)` |
| Job backlog signal | `where event == "job.run" and ['job.batch_full'] == true \| summarize count() by ['job.name'], bin(_time, 1d)` |

## Part D — Monitors (email notifier)

1. **5xx errors** — threshold: `where msg == "request" and ['http.response.status_code'] >= 500 | count` over 10 min, alert ≥ 1 (tune up later with traffic).
2. **Job run failed / partial** — match monitor: `event == "job.run" and (['job.status'] == "failure" or ['job.items_failed'] > 0)`.
3. **Scheduler liveness** — threshold below: `where event == "job.run" | count` over 26 h, alert < 3 (3 daily jobs; a dead scheduler emits nothing).
4. **Webhook signature failures** — threshold: `error_type in ("StripeSignatureInvalid", "MuxSignatureInvalid") | count` over 1 h, alert ≥ 5 (probing/misconfig signal).

## Verification

Local:
1. `cd server && npm run typecheck && npx vitest run` — green with no Axiom env set (proves tests independent).
2. Real values in `.env.local` → `npm run dev` → hit `/health` a few times → events appear in Axiom with `env == "development"`, `msg == "request"`, redacted fields redacted.
3. Failure drill: `AXIOM_TOKEN=garbage` → routes still return 200, stderr shows ingest errors, no crash.
4. Ctrl-C → the `shutdown` event itself appears in Axiom (flush window works).

Railway (after vars set, then deploy):
1. Railway log viewer still shows NDJSON (stdout target intact).
2. `/health` event in Axiom has `env == "production"` and `version` = deployed SHA.
3. `/debug-sentry` → Sentry event and the 500 request event in Axiom share `request_id`.
4. Redeploy → old instance's `shutdown` event reached Axiom (SIGTERM flush works).
5. Build dashboard panels + monitors (Parts C/D), send a monitor test email.

## Out of scope
- Dashboards-as-code (Terraform) — manual UI setup is fine at this scale; APL queries above are the record.
- Paid tier / retention > 30 days — revisit if quarter-over-quarter comparisons are ever needed.
