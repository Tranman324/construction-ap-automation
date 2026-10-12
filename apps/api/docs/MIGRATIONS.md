# Database Migrations

This backend uses a minimal in-repo SQL migration runner backed by Postgres and `schema_migrations` tracking. Migration files live in `migrations/` and must be named:

```text
YYYY-MM-DD_description.sql
```

The runner does not replace review. Treat production migrations as live-environment operations and verify the target before applying or marking migrations.

## Environment

For Supabase production or staging, set:

```bash
SUPABASE_DB_URL=<postgres connection URL>
```

For local Postgres, set any needed `PG*` variables:

```bash
PGHOST=localhost
PGPORT=5432
PGDATABASE=toolbox
PGUSER=toolbox
PGPASSWORD=<password>
```

Never print or commit database URLs, passwords, service-role keys, tokens, or full sensitive payloads.

## Commands

List migration files and rerun safety classification. This does not connect to the database.

```bash
npm run migrate
npm run migrate -- list
```

Apply pending migrations in lexical order, skipping filenames already recorded in `public.schema_migrations`.

```bash
npm run migrate -- apply --confirm-target
```

Mark already-applied migrations without running their SQL.

```bash
npm run migrate -- mark-applied <migration.sql> [migration.sql ...] --confirm-target
```

For live Supabase targets using `SUPABASE_DB_URL`, `apply` and `mark-applied` require `--confirm-target`. The runner prints non-secret target facts before it mutates anything: mode, source, host, port, database, user, and SSL mode.

## Tracking Table

The runner creates `public.schema_migrations` when applying or marking migrations:

- `filename TEXT PRIMARY KEY`
- `applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

The table has RLS enabled, a trusted-role policy when `postgres` or `service_role` exists, and explicit revokes for `anon` and `authenticated` when those roles exist. This keeps the tracking table deliberate in Supabase projects where public-schema tables may otherwise be exposed through Data API grants.

## Historical Migration Classification

These files existed before tracking was introduced. In production, bootstrap them as already applied only after confirming the target has the expected schema state.

| Migration | Classification | Reason |
| --- | --- | --- |
| `2026-04-11_rls_hardening.sql` | Safe to rerun | Drops/recreates the named policy and uses idempotent RLS operations. |
| `2026-04-11_soft_delete.sql` | Safe to rerun | Uses `ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. |
| `2026-04-13_job_feedback_cache.sql` | Mark applied | Creates a policy without dropping/replacing it first. |
| `2026-04-29_feature_requests_rls.sql` | Mark applied | Creates policies without dropping/replacing them first. |
| `2026-05-07_add_phone_to_toolbox_users.sql` | Safe to rerun | Uses `ADD COLUMN IF NOT EXISTS`; the column comment is replaceable. |
| `2026-06-22_permission_lien_waiver_gates.sql` | Safe to rerun | Uses `ON CONFLICT` upsert semantics for permissions and admin grants. |
| `2026-06-22_audit_events.sql` | Safe to rerun | Uses `CREATE TABLE/INDEX IF NOT EXISTS` and replaces the RLS policy. |
| `2026-06-23_permission_rules_gates.sql` | Safe to rerun | Uses `ON CONFLICT` upsert semantics for the automation rules permission and admin grant. |

## Production Bootstrap Checklist

Do not run these commands until the Manager explicitly approves live migration operations.

1. Confirm the target host/database/user printed by the runner are the intended Supabase project.
2. Confirm the historical schema state with narrow read-only introspection. At minimum, verify:
   - `job_mappings` exists.
   - `feature_requests` and `feature_votes` have the expected RLS policies.
   - `toolbox_users.phone` exists if phone persistence has already been deployed.
   - Permission rows and admin grants exist for `feature_requests.manage` and `invoices.permanent_delete`.
   - `audit_events` exists with its indexes and `service_role_full_access` policy.
3. Bootstrap current historical files as applied:

```bash
npm run migrate -- mark-applied \
  2026-04-11_rls_hardening.sql \
  2026-04-11_soft_delete.sql \
  2026-04-13_job_feedback_cache.sql \
  2026-04-29_feature_requests_rls.sql \
  2026-05-07_add_phone_to_toolbox_users.sql \
  2026-06-22_permission_lien_waiver_gates.sql \
  2026-06-22_audit_events.sql \
  --confirm-target
```

4. Verify no pending migrations remain:

```bash
npm run migrate -- apply --confirm-target
npm run migrate -- apply --confirm-target
```

The second apply should be a no-op. After any production migration activity, follow the deployment verification rules in `AGENTS.md`: restart `invoice-api`, confirm it is `active (running)`, smoke-test the changed behavior, and inspect relevant service logs.

## Future Migrations

Prefer idempotent SQL for new files:

- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `INSERT ... ON CONFLICT`
- `DROP POLICY IF EXISTS ...` before `CREATE POLICY`

Avoid manual production SQL outside this runner except narrow read-only introspection approved for verification.
