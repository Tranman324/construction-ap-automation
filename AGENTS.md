# Contributor guide

Rules for anyone (human or coding agent) changing this repo.

## Layout

- `apps/api`: Express backend. Business logic lives in `modules/<domain>/services`; routes are transport-only.
- `apps/web`: Next.js frontend. Feature code lives in `src/modules/<domain>`.
- `test-fixtures`: shared golden vectors used by both apps.

## Before you open a PR

1. Run `npm test` in `apps/api` (lint plus the node test runner) and `npx vitest run` in `apps/web`.
2. Endpoint and route changes must follow `apps/api/docs/ENDPOINT-STANDARD.md`.
3. Update `apps/api/API.md` and `apps/web/docs/specs/invoices/CONTRACTS.md` when a response contract changes.
4. Migrations are append-only. Never edit an applied migration; add a follow-up file.
5. Never commit secrets, tenant IDs, or real customer data. Configuration comes from environment variables.
